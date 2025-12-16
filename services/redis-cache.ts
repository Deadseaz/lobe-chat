/**
 * Redis Cache Service for Knowledge Base
 * Implements caching for knowledge base operations using Redis
 */

import { createClient, RedisClientType } from 'redis';

export interface RedisConfig {
  url: string;
  defaultTTL: number;
  maxRetries: number;
}

export class RedisCacheService {
  private client: RedisClientType | null = null;
  private config: RedisConfig;

  constructor(config: RedisConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    try {
      this.client = createClient({
        url: this.config.url
      });

      this.client.on('error', (err: Error) => {
        console.error('Redis Client Error:', err);
      });

      await this.client.connect();
      console.log('Connected to Redis successfully');
    } catch (error) {
      console.error('Failed to connect to Redis:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }

  /**
   * Caches a knowledge base query result
   */
  async cacheQueryResult(queryHash: string, result: any, ttl?: number): Promise<void> {
    if (!this.client) {
      throw new Error('Redis client not connected');
    }

    const expiration = ttl || this.config.defaultTTL;
    await this.client.setEx(queryHash, expiration, JSON.stringify(result));
  }

  /**
   * Retrieves a cached knowledge base query result
   */
  async getCachedResult(queryHash: string): Promise<any | null> {
    if (!this.client) {
      throw new Error('Redis client not connected');
    }

    const cached = await this.client.get(queryHash);
    return cached ? JSON.parse(cached) : null;
  }

  /**
   * Caches a knowledge base document
   */
  async cacheDocument(docId: string, document: any, ttl?: number): Promise<void> {
    if (!this.client) {
      throw new Error('Redis client not connected');
    }

    const expiration = ttl || this.config.defaultTTL * 2; // Documents might have longer TTL
    await this.client.setEx(`kb:doc:${docId}`, expiration, JSON.stringify(document));
  }

  /**
   * Retrieves a cached knowledge base document
   */
  async getCachedDocument(docId: string): Promise<any | null> {
    if (!this.client) {
      throw new Error('Redis client not connected');
    }

    const cached = await this.client.get(`kb:doc:${docId}`);
    return cached ? JSON.parse(cached) : null;
  }

  /**
   * Invalidates cached results matching a pattern
   */
  async invalidateCache(pattern: string): Promise<void> {
    if (!this.client) {
      throw new Error('Redis client not connected');
    }

    const keys = await this.client.keys(pattern);
    if (keys.length > 0) {
      await this.client.del(keys);
    }
  }

  /**
   * Checks if a key exists in cache
   */
  async exists(key: string): Promise<boolean> {
    if (!this.client) {
      throw new Error('Redis client not connected');
    }

    const result = await this.client.exists(key);
    return result === 1;
  }

  /**
   * Sets a key with a value and TTL
   */
  async set(key: string, value: any, ttl?: number): Promise<void> {
    if (!this.client) {
      throw new Error('Redis client not connected');
    }

    const expiration = ttl || this.config.defaultTTL;
    await this.client.setEx(key, expiration, JSON.stringify(value));
  }

  /**
   * Gets a value by key
   */
  async get(key: string): Promise<any | null> {
    if (!this.client) {
      throw new Error('Redis client not connected');
    }

    const value = await this.client.get(key);
    return value ? JSON.parse(value) : null;
  }
}

/**
 * Session management using Redis
 */
export class KnowledgeBaseSessionService {
  private redisService: RedisCacheService;

  constructor(redisService: RedisCacheService) {
    this.redisService = redisService;
  }

  /**
   * Creates a new knowledge base session
   */
  async createSession(userId: string, sessionId: string, sessionData: any): Promise<void> {
    const key = `kb:session:${userId}:${sessionId}`;
    await this.redisService.set(key, sessionData, 3600); // 1 hour TTL
  }

  /**
   * Retrieves a knowledge base session
   */
  async getSession(userId: string, sessionId: string): Promise<any | null> {
    const key = `kb:session:${userId}:${sessionId}`;
    return await this.redisService.get(key);
 }

  /**
   * Updates a knowledge base session
   */
  async updateSession(userId: string, sessionId: string, updates: any): Promise<void> {
    const key = `kb:session:${userId}:${sessionId}`;
    const currentSession = await this.getSession(userId, sessionId) || {};
    const updatedSession = { ...currentSession, ...updates };
    await this.redisService.set(key, updatedSession, 3600); // 1 hour TTL
  }

  /**
   * Deletes a knowledge base session
   */
  async deleteSession(userId: string, sessionId: string): Promise<void> {
    const key = `kb:session:${userId}:${sessionId}`;
    await this.redisService.set(key, null); // This will delete the key since value is null
  }
}

/**
 * Rate limiting using Redis
 */
export class RateLimitService {
  private redisService: RedisCacheService;

  constructor(redisService: RedisCacheService) {
    this.redisService = redisService;
  }

  /**
   * Checks if a user is rate limited
   */
  async isRateLimited(identifier: string, limit: number, windowMs: number): Promise<boolean> {
    const key = `rate_limit:${identifier}`;
    const current = await this.redisService.get(key);

    if (current === null) {
      // First request, set counter with expiration
      await this.redisService.set(key, { count: 1, resetTime: Date.now() + windowMs }, Math.ceil(windowMs / 1000));
      return false;
    }

    const data = current as { count: number; resetTime: number };
    
    if (Date.now() > data.resetTime) {
      // Window has passed, reset counter
      await this.redisService.set(key, { count: 1, resetTime: Date.now() + windowMs }, Math.ceil(windowMs / 1000));
      return false;
    }

    if (data.count >= limit) {
      return true; // Rate limited
    }

    // Increment counter
    await this.redisService.set(key, { count: data.count + 1, resetTime: data.resetTime }, Math.ceil(windowMs / 1000));
    return false;
  }

  /**
   * Gets rate limit info for an identifier
   */
  async getRateLimitInfo(identifier: string, limit: number, windowMs: number): Promise<{ remaining: number; resetTime: number }> {
    const key = `rate_limit:${identifier}`;
    const current = await this.redisService.get(key);

    if (current === null) {
      return { remaining: limit, resetTime: Date.now() + windowMs };
    }

    const data = current as { count: number; resetTime: number };
    
    if (Date.now() > data.resetTime) {
      return { remaining: limit, resetTime: Date.now() + windowMs };
    }

    const remaining = Math.max(0, limit - data.count);
    return { remaining, resetTime: data.resetTime };
  }
}