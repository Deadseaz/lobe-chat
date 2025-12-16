import { Context } from 'hono';
import fetch from 'node-fetch';

export interface NginxProxyManagerConfig {
    apiUrl: string;
    apiKey: string;
}

export class NginxProxyManagerService {
    private config: NginxProxyManagerConfig;

    constructor(config: NginxProxyManagerConfig) {
        this.config = config;
    }

    private async makeRequest(endpoint: string, method: string = 'GET', body?: any) {
        const headers = {
            'Authorization': `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
        };

        const response = await fetch(`${this.config.apiUrl}${endpoint}`, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
        });

        if (!response.ok) {
            throw new Error(`Nginx Proxy Manager API Error: ${response.status} - ${response.statusText}`);
        }

        return response.json();
    }

    async listProxyHosts() {
        return this.makeRequest('/api/nginx/proxy-hosts');
    }

    async createProxyHost(hostData: any) {
        return this.makeRequest('/api/nginx/proxy-hosts', 'POST', hostData);
    }
}

export const initializeNginxProxyManagerService = (c: Context, next: () => Promise<void>) => {
    const apiUrl = c.env['NGINX_PROXY_MANAGER_API_URL'];
    const apiKey = c.env['NGINX_PROXY_MANAGER_API_KEY'];

    if (!apiUrl || !apiKey) {
        // If the Nginx Proxy Manager isn't configured, we'll just skip this middleware.
        // This allows the agent to run without it.
        return next();
    }

    const nginxService = new NginxProxyManagerService({ apiUrl, apiKey });
    c.set('nginxService', nginxService);
    return next();
};
