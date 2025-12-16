import { Context } from "hono";

export class CloudflareService {
  private readonly apiToken: string;
  private readonly accountId: string;
  private readonly baseUrl = "https://api.cloudflare.com/client/v4";

  constructor(env: any) {
    this.apiToken = env.CF_API_TOKEN;
    this.accountId = env.CF_ACCOUNT_ID;
  }

  private getHeaders() {
    return {
      Authorization: `Bearer ${this.apiToken}`,
      "Content-Type": "application/json",
    };
  }

  async listZones() {
    if (!this.apiToken || !this.accountId) {
      throw new Error("Cloudflare credentials not configured in .env");
    }
    const response = await fetch(`${this.baseUrl}/zones`, {
      headers: this.getHeaders(),
    });
    if (!response.ok) {
      throw new Error(
        `Failed to list Cloudflare zones: ${response.statusText}`,
      );
    }
    const data = (await response.json()) as { result: any[] };
    return data.result || [];
  }

  async listWorkers() {
    if (!this.apiToken || !this.accountId) {
      throw new Error("Cloudflare credentials not configured in .env");
    }
    const response = await fetch(
      `${this.baseUrl}/accounts/${this.accountId}/workers/scripts`,
      { headers: this.getHeaders() },
    );
    if (!response.ok) {
      throw new Error(
        `Failed to list Cloudflare workers: ${response.statusText}`,
      );
    }
    const data = (await response.json()) as { result: any[] };
    return data.result || [];
  }
}

export async function initializeCloudflareService(
  c: Context,
  next: () => Promise<void>,
) {
  const service = new CloudflareService(c.env || process.env);
  c.set("cloudflareService", service);
  await next();
}
