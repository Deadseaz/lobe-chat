import { Context } from 'hono';
import fetch from 'node-fetch';

export interface D1Config {
  accountId: string;
  databaseId: string;
  token: string;
}

export interface D1QueryResult {
  success: boolean;
  result: any[];
  meta: {
    duration: number;
    rows_read: number;
    rows_written: number;
  };
}

export class D1Service {
  private config: D1Config;
  private baseUrl: string;

  constructor(config: D1Config) {
    this.config = config;
    this.baseUrl = `https://api.cloudflare.com/client/v4/accounts/${this.config.accountId}/d1/database/${this.config.databaseId}`;
  }

  private async makeRequest(endpoint: string, method: string = 'GET', body?: any): Promise<any> {
    const headers: HeadersInit = {
      'Authorization': `Bearer ${this.config.token}`,
      'Content-Type': 'application/json',
    };

    const options: RequestInit = {
      method,
      headers,
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, options);

    if (!response.ok) {
      throw new Error(`D1 API Error: ${response.status} - ${response.statusText}`);
    }

    return response.json();
  }

  async query(sql: string, params?: any[]): Promise<D1QueryResult> {
    const requestBody = {
      sql,
      params: params || [],
    };
    return this.makeRequest('/query', 'POST', requestBody);
  }

  async batch(queries: string[]): Promise<D1QueryResult[]> {
    const requestBody = {
      queries: queries.map(query => ({
        sql: query,
        params: [],
      })),
    };
    return this.makeRequest('/query', 'POST', requestBody);
  }

  async execute(sql: string, params?: any[]): Promise<D1QueryResult> {
    const requestBody = {
      sql,
      params: params || [],
    };
    return this.makeRequest('/execute', 'POST', requestBody);
  }
}

export const initializeD1Service = async (c: Context, next: () => Promise<void>) => {
  const accountId = c.env['CF_ACCOUNT_ID'];
  const databaseId = c.env['CF_D1_DATABASE_ID'];
  const token = c.env['CF_D1_TOKEN'];

  if (!accountId || !databaseId || !token) {
      c.status(500);
      return c.json({ error: 'D1 database credentials not configured' });
  }

  const d1Service = new D1Service({
    accountId,
    databaseId,
    token,
  });

  c.set('d1Service', d1Service);
  await next();
  return;
};
