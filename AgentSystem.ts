/**
 * AgentSystem - Initializes and manages the complete multi-agent system
 */

import { AgentOrchestrator } from './AgentOrchestrator';
import { InfrastructureAgent } from './InfrastructureAgent';
import { MonitoringAgent } from './MonitoringAgent';
import { KnowledgeAgent } from './KnowledgeAgent';
import { BaseAgent } from './BaseAgent';
import { AgentContext, AgentTask } from './types';

// Local MessageBus stub for Node.js (uses Redis backend)
class MessageBus {
  private subscribers: Map<string, ((msg: any) => Promise<void>)[]> = new Map();
  
  constructor(_config: any) {}
  
  async publish(message: any): Promise<void> {
    const to = Array.isArray(message.to) ? message.to : [message.to];
    for (const target of to) {
      const handlers = this.subscribers.get(target) || [];
      for (const handler of handlers) {
        await handler(message);
      }
    }
  }
  
  subscribe(agentId: string, handler: (msg: any) => Promise<void>): void {
    if (!this.subscribers.has(agentId)) {
      this.subscribers.set(agentId, []);
    }
    this.subscribers.get(agentId)!.push(handler);
  }
  
  unsubscribe(agentId: string): void {
    this.subscribers.delete(agentId);
  }
}

export interface AgentSystemConfig {
  messageBusBackend: 'durable-objects' | 'redis' | 'memory';
  enableInfrastructureAgent?: boolean;
  enableMonitoringAgent?: boolean;
  enableKnowledgeAgent?: boolean;
  orchestratorConfig?: any;
}

export class AgentSystem {
  private messageBus: MessageBus;
  private orchestrator: AgentOrchestrator;
  private agents: Map<string, BaseAgent> = new Map();
  private context: AgentContext;
  private isInitialized: boolean = false;

  constructor(context: AgentContext, config: AgentSystemConfig) {
    this.context = context;

    // Initialize message bus
    this.messageBus = new MessageBus({
      backend: config.messageBusBackend,
      durableObjectNamespace: context.env?.AGENT_MESSAGE_BUS,
      redisClient: context.services?.redisService
    });

    // Add message bus to context
    this.context.messageBus = this.messageBus;

    // Initialize orchestrator
    this.orchestrator = new AgentOrchestrator(
      this.context,
      config.orchestratorConfig
    );

    // Register orchestrator
    this.agents.set(this.orchestrator.getMetadata().id, this.orchestrator);

    // Initialize specialized agents based on config
    if (config.enableInfrastructureAgent !== false) {
      const infraAgent = new InfrastructureAgent(this.context);
      this.agents.set(infraAgent.getMetadata().id, infraAgent);
    }

    if (config.enableMonitoringAgent !== false) {
      const monitoringAgent = new MonitoringAgent(this.context);
      this.agents.set(monitoringAgent.getMetadata().id, monitoringAgent);
    }

    if (config.enableKnowledgeAgent !== false) {
      const knowledgeAgent = new KnowledgeAgent(this.context);
      this.agents.set(knowledgeAgent.getMetadata().id, knowledgeAgent);
    }

    console.log(`[AgentSystem] Initialized with ${this.agents.size} agents`);
  }

  /**
   * Initialize all agents in the system
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.warn('[AgentSystem] Already initialized');
      return;
    }

    console.log('[AgentSystem] Initializing all agents...');

    try {
      // Initialize all agents in parallel
      await Promise.all(
        Array.from(this.agents.values()).map(agent =>
          agent.initialize().catch(err => {
            console.error(`Failed to initialize agent ${agent.getMetadata().name}:`, err);
            throw err;
          })
        )
      );

      this.isInitialized = true;
      console.log('[AgentSystem] All agents initialized successfully');
    } catch (error) {
      console.error('[AgentSystem] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Submit a task to the system (goes through orchestrator)
   */
  async submitTask(task: AgentTask): Promise<string> {
    if (!this.isInitialized) {
      throw new Error('AgentSystem not initialized. Call initialize() first.');
    }

    return this.orchestrator.submitTask(task);
  }

  /**
   * Get task status
   */
  async getTaskStatus(taskId: string): Promise<any> {
    return this.orchestrator.getTaskStatus(taskId);
  }

  /**
   * Get orchestrator instance
   */
  getOrchestrator(): AgentOrchestrator {
    return this.orchestrator;
  }

  /**
   * Get all agents
   */
  getAllAgents(): BaseAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get agent by ID
   */
  getAgent(agentId: string): BaseAgent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get system health
   */
  getSystemHealth(): any {
    return this.orchestrator.getSystemHealth();
  }

  /**
   * Shutdown all agents gracefully
   */
  async shutdown(): Promise<void> {
    console.log('[AgentSystem] Shutting down all agents...');

    await Promise.all(
      Array.from(this.agents.values()).map(agent =>
        agent.shutdown().catch(err =>
          console.error(`Error shutting down agent ${agent.getMetadata().name}:`, err)
        )
      )
    );

    this.isInitialized = false;
    console.log('[AgentSystem] All agents shut down');
  }

  /**
   * Get message bus instance
   */
  getMessageBus(): MessageBus {
    return this.messageBus;
  }
}

/**
 * Factory function to create and initialize AgentSystem
 */
export async function createAgentSystem(
  context: AgentContext,
  config: AgentSystemConfig
): Promise<AgentSystem> {
  const system = new AgentSystem(context, config);
  await system.initialize();
  return system;
}
