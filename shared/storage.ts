/**
 * Shared Storage Service - Redis-backed persistent storage
 * Replaces in-memory storage with Redis for persistence across restarts
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import Redis from 'ioredis';
import { config } from './config';

export interface StorageOptions {
  prefix?: string;
  ttl?: number; // seconds
}

/**
 * Redis Storage Service - Persistent key-value storage
 */
export class RedisStorage {
  private client: any = null;
  private prefix: string;
  private defaultTTL: number;
  private connected: boolean = false;
  private fallbackStorage: Map<string, any> = new Map();

  constructor(options?: StorageOptions) {
    this.prefix = options?.prefix || 'agent:';
    this.defaultTTL = options?.ttl || 86400; // 24 hours default
  }

  /**
   * Connect to Redis
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    try {
      const redisConfig = config.getRedis();
      
      this.client = new Redis({
        host: redisConfig.host,
        port: redisConfig.port,
        password: redisConfig.password || undefined,
        db: redisConfig.db || 0,
        retryStrategy: (times) => {
          if (times > 3) {
            console.warn('Redis connection failed, using fallback storage');
            return null; // Stop retrying
          }
          return Math.min(times * 100, 3000);
        },
        lazyConnect: true
      });

      await this.client.connect();
      this.connected = true;
      console.log('Redis storage connected');
    } catch (error) {
      console.warn('Redis connection failed, using in-memory fallback:', error);
      this.client = null;
      this.connected = false;
    }
  }

  /**
   * Get a value by key
   */
  async get<T = any>(key: string): Promise<T | null> {
    const fullKey = this.prefix + key;

    if (this.client && this.connected) {
      try {
        const value = await this.client.get(fullKey);
        return value ? JSON.parse(value) : null;
      } catch (error) {
        console.warn('Redis get error:', error);
      }
    }

    // Fallback to in-memory
    return this.fallbackStorage.get(fullKey) || null;
  }

  /**
   * Set a value with optional TTL
   */
  async set(key: string, value: any, ttl?: number): Promise<void> {
    const fullKey = this.prefix + key;
    const serialized = JSON.stringify(value);
    const expiry = ttl || this.defaultTTL;

    if (this.client && this.connected) {
      try {
        if (expiry > 0) {
          await this.client.setex(fullKey, expiry, serialized);
        } else {
          await this.client.set(fullKey, serialized);
        }
        return;
      } catch (error) {
        console.warn('Redis set error:', error);
      }
    }

    // Fallback to in-memory
    this.fallbackStorage.set(fullKey, value);
  }

  /**
   * Delete a key
   */
  async delete(key: string): Promise<void> {
    const fullKey = this.prefix + key;

    if (this.client && this.connected) {
      try {
        await this.client.del(fullKey);
      } catch (error) {
        console.warn('Redis delete error:', error);
      }
    }

    this.fallbackStorage.delete(fullKey);
  }

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    const fullKey = this.prefix + key;

    if (this.client && this.connected) {
      try {
        return (await this.client.exists(fullKey)) === 1;
      } catch (error) {
        console.warn('Redis exists error:', error);
      }
    }

    return this.fallbackStorage.has(fullKey);
  }

  /**
   * Get all keys matching a pattern
   */
  async keys(pattern: string = '*'): Promise<string[]> {
    const fullPattern = this.prefix + pattern;

    if (this.client && this.connected) {
      try {
        const keys = await this.client.keys(fullPattern);
        return keys.map(k => k.replace(this.prefix, ''));
      } catch (error) {
        console.warn('Redis keys error:', error);
      }
    }

    // Fallback
    return Array.from(this.fallbackStorage.keys())
      .filter(k => k.startsWith(this.prefix))
      .map(k => k.replace(this.prefix, ''));
  }

  /**
   * Increment a counter
   */
  async incr(key: string): Promise<number> {
    const fullKey = this.prefix + key;

    if (this.client && this.connected) {
      try {
        return await this.client.incr(fullKey);
      } catch (error) {
        console.warn('Redis incr error:', error);
      }
    }

    // Fallback
    const current = this.fallbackStorage.get(fullKey) || 0;
    const next = current + 1;
    this.fallbackStorage.set(fullKey, next);
    return next;
  }

  /**
   * Add to a set
   */
  async sadd(key: string, ...members: string[]): Promise<number> {
    const fullKey = this.prefix + key;

    if (this.client && this.connected) {
      try {
        return await this.client.sadd(fullKey, ...members);
      } catch (error) {
        console.warn('Redis sadd error:', error);
      }
    }

    // Fallback
    let set = this.fallbackStorage.get(fullKey) as Set<string>;
    if (!set) {
      set = new Set();
      this.fallbackStorage.set(fullKey, set);
    }
    let added = 0;
    for (const member of members) {
      if (!set.has(member)) {
        set.add(member);
        added++;
      }
    }
    return added;
  }

  /**
   * Get set members
   */
  async smembers(key: string): Promise<string[]> {
    const fullKey = this.prefix + key;

    if (this.client && this.connected) {
      try {
        return await this.client.smembers(fullKey);
      } catch (error) {
        console.warn('Redis smembers error:', error);
      }
    }

    // Fallback
    const set = this.fallbackStorage.get(fullKey) as Set<string>;
    return set ? Array.from(set) : [];
  }

  /**
   * Push to a list
   */
  async lpush(key: string, ...values: string[]): Promise<number> {
    const fullKey = this.prefix + key;

    if (this.client && this.connected) {
      try {
        return await this.client.lpush(fullKey, ...values);
      } catch (error) {
        console.warn('Redis lpush error:', error);
      }
    }

    // Fallback
    let list = this.fallbackStorage.get(fullKey) as any[];
    if (!list) {
      list = [];
      this.fallbackStorage.set(fullKey, list);
    }
    list.unshift(...values);
    return list.length;
  }

  /**
   * Get list range
   */
  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const fullKey = this.prefix + key;

    if (this.client && this.connected) {
      try {
        return await this.client.lrange(fullKey, start, stop);
      } catch (error) {
        console.warn('Redis lrange error:', error);
      }
    }

    // Fallback
    const list = this.fallbackStorage.get(fullKey) as any[] || [];
    const end = stop === -1 ? undefined : stop + 1;
    return list.slice(start, end);
  }

  /**
   * Publish to a channel
   */
  async publish(channel: string, message: any): Promise<void> {
    if (this.client && this.connected) {
      try {
        await this.client.publish(channel, JSON.stringify(message));
      } catch (error) {
        console.warn('Redis publish error:', error);
      }
    }
  }

  /**
   * Health check
   */
  async ping(): Promise<boolean> {
    if (this.client && this.connected) {
      try {
        const result = await this.client.ping();
        return result === 'PONG';
      } catch {
        return false;
      }
    }
    return false;
  }

  /**
   * Close connection
   */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.connected = false;
    }
  }

  /**
   * Get connection status
   */
  isConnected(): boolean {
    return this.connected;
  }
}

// Export singleton instance
export const storage = new RedisStorage();
