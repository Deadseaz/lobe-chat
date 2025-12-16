/**
 * Cloudflare API Service
 * Handles all interactions with Cloudflare REST API
 */

import { Context } from 'hono';
import { CloudflareEnv, ZAgentError, ErrorType } from '../types/core.js';

export interface CloudflareAPIConfig {
  CF_API_TOKEN: string;
  CF_ACCOUNT_ID: string;
  CF_EMAIL?: string;
}

/**
 * Cloudflare API Response Structure
 * All Cloudflare API responses follow this structure
 */
interface CloudflareAPIResponse<T = unknown> {
  success: boolean;
  errors?: Array<{
    code: number;
    message: string;
  }>;
  messages?: Array<{
    code: number;
    message: string;
  }>;
  result: T;
  result_info?: {
    page: number;
    per_page: number;
    total_pages: number;
    count: number;
    total_count: number;
  };
}

export class CloudflareAPI {
  private apiToken: string;
  private accountId: string;
  private baseUrl = 'https://api.cloudflare.com/client/v4';
  private email?: string;
  private maxRetries = 3;
  private retryDelay = 1000;

  constructor(config: CloudflareAPIConfig) {
    if (!config.CF_API_TOKEN) {
      throw new ZAgentError(
        ErrorType.VALIDATION,
        'Cloudflare API token is required',
        400
      );
    }

    if (!config.CF_ACCOUNT_ID) {
      throw new ZAgentError(
        ErrorType.VALIDATION,
        'Cloudflare Account ID is required',
        400
      );
    }

    this.apiToken = config.CF_API_TOKEN;
    this.accountId = config.CF_ACCOUNT_ID;
    this.email = config.CF_EMAIL;
  }

  private getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiToken}`,
      'Content-Type': 'application/json',
    };
  }

  private async makeRequest<T = unknown>(
    url: string,
    options: RequestInit = {},
    retries = 0
  ): Promise<T> {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          ...this.getHeaders(),
          ...options.headers,
        },
      });

      // Type the response as Cloudflare's standard API response structure
      const data = (await response.json()) as CloudflareAPIResponse<T>;

      if (!response.ok) {
        const errorMessage =
          data.errors?.[0]?.message ||
          JSON.stringify(data.errors) ||
          'Unknown error';

        throw new ZAgentError(
          ErrorType.EXTERNAL_SERVICE,
          `Cloudflare API error: ${response.status} ${response.statusText} - ${errorMessage}`,
          response.status,
          data
        );
      }

      // Return the result from Cloudflare's response structure
      return data.result;
    } catch (error) {
      // Retry logic for network errors and 5xx/429 responses
      if (
        retries < this.maxRetries &&
        (error instanceof TypeError ||
          (error instanceof ZAgentError &&
            (error.statusCode >= 500 || error.statusCode === 429)))
      ) {
        const delay = this.retryDelay * Math.pow(2, retries);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.makeRequest<T>(url, options, retries + 1);
      }
      throw error;
    }
  }

  // Account methods
  async getAccount() {
    return this.makeRequest(`${this.baseUrl}/accounts/${this.accountId}`);
  }

  async listAccounts() {
    return this.makeRequest(`${this.baseUrl}/accounts`);
  }

  // Zone methods
  async listZones(page = 1, perPage = 50) {
    return this.makeRequest(
      `${this.baseUrl}/zones?page=${page}&per_page=${perPage}`
    );
  }

  async getZone(zoneId: string) {
    return this.makeRequest(`${this.baseUrl}/zones/${zoneId}`);
  }

  // Worker methods
  async listWorkers() {
    return this.makeRequest(
      `${this.baseUrl}/accounts/${this.accountId}/workers/scripts`
    );
  }

  async getWorker(name: string) {
    return this.makeRequest(
      `${this.baseUrl}/accounts/${this.accountId}/workers/scripts/${name}`
    );
  }

  async deployWorker(name: string, script: string, metadata?: Record<string, unknown>) {
    const formData = new FormData();
    const scriptBlob = new Blob([script], { type: 'application/javascript' });
    formData.append('script', scriptBlob);

    if (metadata) {
      const metadataBlob = new Blob([JSON.stringify(metadata)], {
        type: 'application/json',
      });
      formData.append('metadata', metadataBlob);
    }

    return this.makeRequest(
      `${this.baseUrl}/accounts/${this.accountId}/workers/scripts/${name}`,
      {
        method: 'PUT',
        body: formData,
      }
    );
  }

  async deleteWorker(name: string) {
    return this.makeRequest(
      `${this.baseUrl}/accounts/${this.accountId}/workers/scripts/${name}`,
      { method: 'DELETE' }
    );
  }

  // DNS methods
  async listDNSRecords(zoneId: string) {
    return this.makeRequest(`${this.baseUrl}/zones/${zoneId}/dns_records`);
  }

  async createDNSRecord(zoneId: string, record: Record<string, unknown>) {
    return this.makeRequest(`${this.baseUrl}/zones/${zoneId}/dns_records`, {
      method: 'POST',
      body: JSON.stringify(record),
    });
  }

  async updateDNSRecord(zoneId: string, recordId: string, record: Record<string, unknown>) {
    return this.makeRequest(
      `${this.baseUrl}/zones/${zoneId}/dns_records/${recordId}`,
      {
        method: 'PUT',
        body: JSON.stringify(record),
      }
    );
  }

  async deleteDNSRecord(zoneId: string, recordId: string) {
    return this.makeRequest(
      `${this.baseUrl}/zones/${zoneId}/dns_records/${recordId}`,
      { method: 'DELETE' }
    );
  }

  // Cache methods
  async purgeCache(
    zoneId: string,
    options: {
      purgeEverything?: boolean;
      files?: string[];
      tags?: string[];
    }
  ) {
    const body: Record<string, unknown> = {};

    if (options.purgeEverything) {
      body.purge_everything = true;
    } else if (options.files && options.files.length > 0) {
      body.files = options.files;
    } else if (options.tags && options.tags.length > 0) {
      body.tags = options.tags;
    } else {
      throw new ZAgentError(
        ErrorType.VALIDATION,
        'Must specify purgeEverything, files, or tags',
        400
      );
    }

    return this.makeRequest(`${this.baseUrl}/zones/${zoneId}/purge_cache`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  // Worker routes
  async listWorkerRoutes(zoneId: string) {
    return this.makeRequest(`${this.baseUrl}/zones/${zoneId}/workers/routes`);
  }

  async createWorkerRoute(zoneId: string, pattern: string, scriptName: string) {
    return this.makeRequest(`${this.baseUrl}/zones/${zoneId}/workers/routes`, {
      method: 'POST',
      body: JSON.stringify({
        pattern,
        script: scriptName,
      }),
    });
  }

  async deleteWorkerRoute(zoneId: string, routeId: string) {
    return this.makeRequest(
      `${this.baseUrl}/zones/${zoneId}/workers/routes/${routeId}`,
      { method: 'DELETE' }
    );
  }
}

/**
 * Initialize Cloudflare API middleware for Hono
 */
export const initializeCloudflareAPI = async (
  c: Context,
  next: () => Promise<void>
) => {
  const config: CloudflareAPIConfig = {
    CF_API_TOKEN: c.env?.CF_API_TOKEN || process.env.CF_API_TOKEN || '',
    CF_ACCOUNT_ID: c.env?.CF_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || '',
    CF_EMAIL: c.env?.CF_EMAIL || process.env.CF_EMAIL,
  };

  const cfApi = new CloudflareAPI(config);
  c.set('cfApi', cfApi);
  await next();
};
