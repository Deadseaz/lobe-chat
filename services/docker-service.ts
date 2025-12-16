import { spawn } from 'child_process';
import { Context } from 'hono';
import fetch from 'node-fetch';

// Interfaces from docker-hub.ts
export interface DockerHubConfig {
  username: string;
  password: string;
}

// Interfaces from docker-service.ts
export interface ContainerConfig {
  image: string;
  name?: string;
  ports?: { host: number; container: number }[];
  env?: { [key: string]: string };
  volumes?: { host: string; container: string }[];
  cmd?: string[];
}

export class DockerService {
  private hubConfig: DockerHubConfig;
  private hubBaseUrl = 'https://hub.docker.com/v2';

  constructor(hubConfig: DockerHubConfig) {
    this.hubConfig = hubConfig;
  }

  // Methods from docker-hub.ts
  private async authenticate(): Promise<string> {
    const response = await fetch(`${this.hubBaseUrl}/users/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: this.hubConfig.username,
        password: this.hubConfig.password,
      }),
    });
    if (!response.ok) {
      throw new Error(`DockerHub authentication failed: ${response.status}`);
    }
    const data: any = await response.json();
    return data.token;
  }

  async searchRepos(query: string) {
    const token = await this.authenticate();
    const response = await fetch(`${this.hubBaseUrl}/search/repositories/?query=${encodeURIComponent(query)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) {
        throw new Error(`DockerHub API Error: ${response.status} - ${response.statusText}`);
    }
    return response.json();
  }

  // Methods from docker-service.ts
  async pullImage(image: string): Promise<{ success: boolean; message: string }> {
    return new Promise((resolve) => {
      const child = spawn('docker', ['pull', image]);
      let output = '';
      child.stdout.on('data', (data) => output += data.toString());
      child.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true, message: `Successfully pulled image: ${image}` });
        } else {
          resolve({ success: false, message: `Failed to pull image` });
        }
      });
    });
  }

  async startContainer(config: ContainerConfig): Promise<{ success: boolean; id?: string; message: string }> {
    return new Promise((resolve) => {
      const cmd = ['run', '-d'];
      if (config.name) cmd.push('--name', config.name);
      if (config.ports) config.ports.forEach(p => cmd.push('-p', `${p.host}:${p.container}`));
      if (config.env) Object.entries(config.env).forEach(([key, value]) => cmd.push('-e', `${key}=${value}`));
      if (config.volumes) config.volumes.forEach(v => cmd.push('-v', `${v.host}:${v.container}`));
      cmd.push(config.image);
      if (config.cmd) cmd.push(...config.cmd);

      const child = spawn('docker', cmd);
      let output = '';
      child.stdout.on('data', (data) => output += data.toString());
      child.on('close', (code) => {
        if (code === 0) {
          const containerId = output.trim();
          resolve({ success: true, id: containerId, message: `Container started successfully with ID: ${containerId}` });
        } else {
          resolve({ success: false, message: `Failed to start container.` });
        }
      });
    });
  }
}

export const initializeDockerService = async (c: Context, next: () => Promise<void>) => {
    const username = c.env?.DOCKERHUB_USERNAME || process.env.DOCKERHUB_USERNAME;
    const password = c.env?.DOCKERHUB_PASSWORD || process.env.DOCKERHUB_PASSWORD;

    if (!username || !password) {
        c.status(500);
        c.json({ error: 'DockerHub credentials not configured' });
        return;
    }

    const dockerService = new DockerService({ username, password });
    c.set('dockerService', dockerService);
    await next();
};
