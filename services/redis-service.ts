import { createClient, RedisClientType } from 'redis';
import { Context } from 'hono';

export class RedisService {
  private client: RedisClientType;
  private isConnected = false;

  constructor(env: any) {
    this.client = createClient({
      url: env.REDIS_URL || 'redis://localhost:6379'
    });

    this.client.on('error', (err) => console.error('Redis Client Error', err));
    this.connect();
  }

  private async connect() {
    if (!this.isConnected) {
      await this.client.connect();
      this.isConnected = true;
    }
  }

  public async get(key: string): Promise<string | null> {
    await this.connect();
    return this.client.get(key);
  }

  public async set(key: string, value: string, ttl?: number): Promise<void> {
    await this.connect();
    if (ttl) {
      await this.client.setEx(key, ttl, value);
    } else {
      await this.client.set(key, value);
    }
  }

  public async disconnect(): Promise<void> {
    if (this.isConnected) {
      await this.client.quit();
      this.isConnected = false;
    }
  }
}

export async function initializeRedisService(c: Context, next: () => Promise<void>) {
  const service = new RedisService(c.env);
  c.set('redisService', service);
  await next();
  await service.disconnect();
}
