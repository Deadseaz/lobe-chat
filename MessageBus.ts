/**
 * AgentMessageBus - Real pub/sub message broker for inter-agent communication
 * Supports both Cloudflare Durable Objects and Redis backends
 */

import { AgentMessage, MessageType } from './types';

export interface MessageHandler {
  (message: AgentMessage): Promise<void>;
}

export interface MessageBusConfig {
  backend: 'durable-objects' | 'redis' | 'memory';
  durableObjectNamespace?: DurableObjectNamespace;
  redisClient?: any;
  ttl?: number; // Default message TTL in seconds
}

/**
 * In-memory message bus for development/testing
 */
class InMemoryMessageBus {
  private subscribers: Map<string, Set<MessageHandler>> = new Map();
  private messageLog: AgentMessage[] = [];
  private maxLogSize = 1000;

  async publish(message: AgentMessage): Promise<void> {
    // Store in log
    this.messageLog.push(message);
    if (this.messageLog.length > this.maxLogSize) {
      this.messageLog.shift();
    }

    // Deliver to subscribers
    const handlers = this.subscribers.get(message.to as string) || new Set();
    const broadcastHandlers = this.subscribers.get('broadcast') || new Set();

    const allHandlers = Array.from(new Set([...handlers, ...broadcastHandlers]));

    await Promise.all(
      allHandlers.map(handler =>
        handler(message).catch(err =>
          console.error('Error in message handler:', err)
        )
      )
    );
  }

  async subscribe(topic: string, handler: MessageHandler): Promise<void> {
    if (!this.subscribers.has(topic)) {
      this.subscribers.set(topic, new Set());
    }
    this.subscribers.get(topic)!.add(handler);
  }

  async unsubscribe(topic: string, handler: MessageHandler): Promise<void> {
    const handlers = this.subscribers.get(topic);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  async getMessageHistory(agentId: string, limit: number = 50): Promise<AgentMessage[]> {
    return this.messageLog
      .filter(msg => msg.to === agentId || msg.from === agentId || msg.to === 'broadcast')
      .slice(-limit);
  }

  clear(): void {
    this.subscribers.clear();
    this.messageLog = [];
  }
}

/**
 * Durable Object-based message bus for Cloudflare Workers
 */
class DurableObjectMessageBus {
  private namespace: DurableObjectNamespace;
  private localHandlers: Map<string, Set<MessageHandler>> = new Map();
  private stubCache: Map<string, DurableObjectStub> = new Map();

  constructor(namespace: DurableObjectNamespace) {
    this.namespace = namespace;
  }

  async publish(message: AgentMessage): Promise<void> {
    try {
      // Handle broadcast
      if (message.to === 'broadcast') {
        // Get stub for broadcast DO
        const stub = this.getStub('broadcast');
        await stub.fetch(new Request('http://do/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(message)
        }));

        // Also deliver locally
        await this.deliverLocally('broadcast', message);
        return;
      }

      // Handle specific recipient(s)
      const recipients = Array.isArray(message.to) ? message.to : [message.to];

      await Promise.all(
        recipients.map(async (recipient) => {
          const stub = this.getStub(recipient);
          await stub.fetch(new Request('http://do/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message)
          }));

          // Deliver locally if subscribed
          await this.deliverLocally(recipient, message);
        })
      );
    } catch (error) {
      console.error('Error publishing message:', error);
      throw error;
    }
  }

  async subscribe(topic: string, handler: MessageHandler): Promise<void> {
    if (!this.localHandlers.has(topic)) {
      this.localHandlers.set(topic, new Set());
    }
    this.localHandlers.get(topic)!.add(handler);

    // Register with Durable Object
    const stub = this.getStub(topic);
    await stub.fetch(new Request('http://do/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic })
    }));
  }

  async unsubscribe(topic: string, handler: MessageHandler): Promise<void> {
    const handlers = this.localHandlers.get(topic);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.localHandlers.delete(topic);
      }
    }
  }

  async getMessageHistory(agentId: string, limit: number = 50): Promise<AgentMessage[]> {
    const stub = this.getStub(agentId);
    const response = await stub.fetch(
      new Request(`http://do/history?limit=${limit}`)
    );
    const data = await response.json() as any;
    return data.messages || [];
  }

  private getStub(id: string): DurableObjectStub {
    if (!this.stubCache.has(id)) {
      const doId = this.namespace.idFromName(id);
      this.stubCache.set(id, this.namespace.get(doId));
    }
    return this.stubCache.get(id)!;
  }

  private async deliverLocally(topic: string, message: AgentMessage): Promise<void> {
    const handlers = this.localHandlers.get(topic);
    if (handlers && handlers.size > 0) {
      await Promise.all(
        Array.from(handlers).map(handler =>
          handler(message).catch(err =>
            console.error('Error in local message handler:', err)
          )
        )
      );
    }
  }
}

/**
 * Redis-based message bus for backend servers
 */
class RedisMessageBus {
  private redisClient: any;
  private subscribers: Map<string, Set<MessageHandler>> = new Map();
  private subscriptionClient: any;
  private isConnected: boolean = false;

  constructor(redisClient: any) {
    this.redisClient = redisClient;
  }

  async connect(): Promise<void> {
    if (this.isConnected) return;

    // Create duplicate client for subscriptions
    this.subscriptionClient = this.redisClient.duplicate();
    await this.subscriptionClient.connect();
    this.isConnected = true;

    console.log('Redis MessageBus connected');
  }

  async publish(message: AgentMessage): Promise<void> {
    if (!this.isConnected) await this.connect();

    const channel = Array.isArray(message.to) ? 'broadcast' : message.to;
    const serialized = JSON.stringify(message);

    // Publish to Redis
    await this.redisClient.publish(`agent:${channel}`, serialized);

    // Store in message log
    await this.redisClient.lPush(`agent:messages:${channel}`, serialized);
    await this.redisClient.lTrim(`agent:messages:${channel}`, 0, 999); // Keep last 1000

    // Set TTL if specified
    if (message.ttl) {
      await this.redisClient.expire(`agent:messages:${channel}`, message.ttl);
    }
  }

  async subscribe(topic: string, handler: MessageHandler): Promise<void> {
    if (!this.isConnected) await this.connect();

    if (!this.subscribers.has(topic)) {
      this.subscribers.set(topic, new Set());

      // Subscribe to Redis channel
      await this.subscriptionClient.subscribe(`agent:${topic}`, async (serialized: string) => {
        try {
          const message = JSON.parse(serialized) as AgentMessage;
          const handlers = this.subscribers.get(topic);
          if (handlers) {
            await Promise.all(
              Array.from(handlers).map(h =>
                h(message).catch(err => console.error('Error in handler:', err))
              )
            );
          }
        } catch (error) {
          console.error('Error processing message:', error);
        }
      });
    }

    this.subscribers.get(topic)!.add(handler);
  }

  async unsubscribe(topic: string, handler: MessageHandler): Promise<void> {
    const handlers = this.subscribers.get(topic);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.subscribers.delete(topic);
        await this.subscriptionClient.unsubscribe(`agent:${topic}`);
      }
    }
  }

  async getMessageHistory(agentId: string, limit: number = 50): Promise<AgentMessage[]> {
    if (!this.isConnected) await this.connect();

    const messages = await this.redisClient.lRange(
      `agent:messages:${agentId}`,
      0,
      limit - 1
    );

    return messages.map((msg: string) => JSON.parse(msg) as AgentMessage);
  }

  async disconnect(): Promise<void> {
    if (this.isConnected) {
      await this.subscriptionClient.quit();
      this.isConnected = false;
    }
  }
}

/**
 * Main MessageBus class - factory pattern
 */
export class MessageBus {
  private implementation: InMemoryMessageBus | DurableObjectMessageBus | RedisMessageBus;
  private config: MessageBusConfig;

  constructor(config: MessageBusConfig) {
    this.config = config;

    switch (config.backend) {
      case 'durable-objects':
        if (!config.durableObjectNamespace) {
          throw new Error('Durable Object namespace required for durable-objects backend');
        }
        this.implementation = new DurableObjectMessageBus(config.durableObjectNamespace);
        break;

      case 'redis':
        if (!config.redisClient) {
          throw new Error('Redis client required for redis backend');
        }
        this.implementation = new RedisMessageBus(config.redisClient);
        break;

      case 'memory':
      default:
        this.implementation = new InMemoryMessageBus();
        break;
    }
  }

  async publish(message: AgentMessage): Promise<void> {
    return this.implementation.publish(message);
  }

  async subscribe(topic: string, handler: MessageHandler): Promise<void> {
    return this.implementation.subscribe(topic, handler);
  }

  async unsubscribe(topic: string, handler: MessageHandler): Promise<void> {
    return this.implementation.unsubscribe(topic, handler);
  }

  async getMessageHistory(agentId: string, limit: number = 50): Promise<AgentMessage[]> {
    return this.implementation.getMessageHistory(agentId, limit);
  }

  getBackend(): string {
    return this.config.backend;
  }
}

/**
 * Durable Object implementation for message bus
 */
export class AgentMessageBusDO {
  state: DurableObjectState;
  env: any;
  subscribers: Set<string> = new Set();
  messages: AgentMessage[] = [];

  constructor(state: DurableObjectState, env: any) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    try {
      switch (url.pathname) {
        case '/publish':
          return await this.handlePublish(request);

        case '/subscribe':
          return await this.handleSubscribe(request);

        case '/history':
          return await this.handleHistory(url);

        default:
          return new Response('AgentMessageBus Durable Object', {
            headers: { 'Content-Type': 'text/plain' }
          });
      }
    } catch (error) {
      console.error('MessageBus DO error:', error);
      return new Response(
        JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  private async handlePublish(request: Request): Promise<Response> {
    const message = await request.json() as AgentMessage;

    // Store message
    this.messages.push(message);
    if (this.messages.length > 1000) {
      this.messages.shift();
    }

    // Persist
    await this.state.storage.put('messages', this.messages);

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private async handleSubscribe(request: Request): Promise<Response> {
    const { topic } = await request.json() as any;
    this.subscribers.add(topic);

    await this.state.storage.put('subscribers', Array.from(this.subscribers));

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private async handleHistory(url: URL): Promise<Response> {
    const limit = parseInt(url.searchParams.get('limit') || '50');

    // Load messages if not in memory
    if (this.messages.length === 0) {
      this.messages = await this.state.storage.get<AgentMessage[]>('messages') || [];
    }

    const recentMessages = this.messages.slice(-limit);

    return new Response(JSON.stringify({ messages: recentMessages }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
