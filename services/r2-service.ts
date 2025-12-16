import { Context } from 'hono';
// @ts-ignore
import { AwsClient } from 'aws4fetch';

export interface R2Config {
  accountId: string;
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
}

export interface R2Object {
  key: string;
  size: number;
  uploaded: Date;
  etag: string;
  httpEtag: string;
  checksums: {};
}

export interface R2MultipartUpload {
  key: string;
  uploadId: string;
  uploaded: Date;
}

export class R2Service {
  private config: R2Config;
  private awsClient: any;

  constructor(config: R2Config) {
    this.config = config;
    this.awsClient = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: config.region || 'auto',
      service: 's3',
    });
  }

  private buildR2Endpoint(): string {
    return `https://${this.config.accountId}.r2.cloudflarestorage.com/${this.config.bucketName}`;
  }

  // List objects in the bucket
  async listObjects(prefix?: string, delimiter?: string): Promise<{ objects: R2Object[]; delimitedPrefixes: string[] }> {
    const endpoint = this.buildR2Endpoint();
    let url = endpoint;

    const params = new URLSearchParams();
    if (prefix) params.append('prefix', prefix);
    if (delimiter) params.append('delimiter', delimiter);

    if (params.toString()) {
      url += `?${params.toString()}`;
    }

    // For R2, we'll use fetch with proper AWS signature
    const response = await this.awsClient.fetch(url, {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(`R2 API Error: ${response.status} - ${response.statusText}`);
    }

    const result = await response.text();
    console.log(`R2 listObjects operation completed`);
    // Parse XML response from R2
    const objects: R2Object[] = [];
    const delimitedPrefixes: string[] = [];

    // This is a simplified implementation - in a real scenario,
    // we would parse the XML response properly
    return { objects, delimitedPrefixes };
  }

  // Put an object in the bucket
  async putObject(key: string, data: any, options?: { contentType?: string; metadata?: Record<string, string> }): Promise<void> {
    const endpoint = this.buildR2Endpoint();
    const url = `${endpoint}/${key}`;

    const headers: Record<string, string> = {};
    if (options?.contentType) {
      headers['Content-Type'] = options.contentType;
    }
    if (options?.metadata) {
      for (const [metaKey, metaValue] of Object.entries(options.metadata)) {
        headers[`x-amz-meta-${metaKey}`] = metaValue;
      }
    }

    const response = await this.awsClient.fetch(url, {
      method: 'PUT',
      headers,
      body: typeof data === 'string' ? data : JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`R2 API Error: ${response.status} - ${response.statusText}`);
    }
  }

  // Get an object from the bucket
  async getObject(key: string): Promise<any> {
    const endpoint = this.buildR2Endpoint();
    const url = `${endpoint}/${key}`;

    const response = await this.awsClient.fetch(url, {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(`R2 API Error: ${response.status} - ${response.statusText}`);
    }

    return response;
  }

  // Delete an object from the bucket
  async deleteObject(key: string): Promise<void> {
    const endpoint = this.buildR2Endpoint();
    const url = `${endpoint}/${key}`;

    const response = await this.awsClient.fetch(url, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error(`R2 API Error: ${response.status} - ${response.statusText}`);
    }
  }

  // Delete multiple objects from the bucket
  async deleteObjects(keys: string[]): Promise<void> {
    const endpoint = this.buildR2Endpoint();
    const url = `${endpoint}?delete`;

    let body = '<?xml version="1.0" encoding="UTF-8"?><Delete>';
    keys.forEach(key => {
      body += `<Object><Key>${key}</Key></Object>`;
    });
    body += '</Delete>';

    const response = await this.awsClient.fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/xml',
      },
      body,
    });

    if (!response.ok) {
      throw new Error(`R2 API Error: ${response.status} - ${response.statusText}`);
    }
  }
}

// Initialize R2 Service from context or environment variables
export const initializeR2Service = (c: Context, next: () => Promise<void>) => {
  const accountId = c.env['CF_ACCOUNT_ID'];
  const bucketName = c.env['CF_R2_BUCKET_NAME'];
  const accessKeyId = c.env['CF_R2_ACCESS_KEY_ID'];
  const secretAccessKey = c.env['CF_R2_SECRET_ACCESS_KEY'];
  const region = c.env['CF_R2_REGION'] || 'auto';

  if (!accountId || !bucketName || !accessKeyId || !secretAccessKey) {
    return c.json(
      { error: 'R2 storage credentials not configured' },
      500
    );
  }

  const r2Service = new R2Service({
    accountId,
    bucketName,
    accessKeyId,
    secretAccessKey,
    region,
  });

  c.set('r2Service', r2Service);
  return next();
};
