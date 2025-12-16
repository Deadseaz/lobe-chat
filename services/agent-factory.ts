/**
 * Agent Factory - Dynamic Agent Creation System
 * 
 * Allows users to describe ANY agent in natural language and have the system:
 * 1. Understand the requirements
 * 2. Generate the agent code
 * 3. Create Docker containers
 * 4. Deploy and orchestrate everything
 * 
 * Examples:
 * - "Create subagents to monitor historic stock data with sentiment analysis"
 * - "Create an affiliate agent that analyzes products and creates landing pages"
 * - "Create a Fortigate expert agent"
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */

import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { storage } from '../shared/storage';
import { aiGateway } from '../shared/services';

const execAsync = promisify(exec);

export interface AgentBlueprint {
  id: string;
  name: string;
  description: string;
  type: 'single' | 'multi-agent' | 'pipeline';
  capabilities: string[];
  requiredServices: string[];
  subAgents?: SubAgentSpec[];
  docker?: DockerSpec;
  code?: GeneratedCode;
  status: 'planning' | 'generating' | 'building' | 'deploying' | 'running' | 'failed';
  createdAt: Date;
  deployedAt?: Date;
  endpoints?: string[];
  error?: string;
}

export interface SubAgentSpec {
  name: string;
  role: string;
  capabilities: string[];
  inputs: string[];
  outputs: string[];
  dependencies?: string[];
}

export interface DockerSpec {
  image?: string;
  dockerfile?: string;
  ports: number[];
  volumes: string[];
  environment: Record<string, string>;
  networks: string[];
}

export interface GeneratedCode {
  mainFile: string;
  files: { path: string; content: string }[];
  dockerfile: string;
  dockerCompose: string;
}

interface AgentTemplate {
  type: string;
  baseImage: string;
  dependencies: string[];
  codeTemplate: string;
}

/**
 * Agent Factory - Creates agents from natural language descriptions
 */
export class AgentFactory {
  private blueprints: Map<string, AgentBlueprint> = new Map();
  private workDir: string;
  private templates: Map<string, AgentTemplate> = new Map();

  constructor(workDir: string = '/app/generated-agents') {
    this.workDir = workDir;
    this.loadTemplates();
  }

  /**
   * Load agent templates
   */
  private loadTemplates(): void {
    // Data Analysis Agent Template
    this.templates.set('data-analysis', {
      type: 'data-analysis',
      baseImage: 'python:3.11-slim',
      dependencies: ['pandas', 'numpy', 'scikit-learn', 'requests', 'redis', 'yfinance'],
      codeTemplate: `
import os
import json
import redis
from flask import Flask, request, jsonify
import pandas as pd
{{IMPORTS}}

app = Flask(__name__)
redis_client = redis.Redis(host=os.getenv('REDIS_HOST', 'redis'), port=6379, decode_responses=True)

{{AGENT_CODE}}

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "healthy", "agent": "{{AGENT_NAME}}"})

@app.route('/execute', methods=['POST'])
def execute():
    data = request.json
    result = agent.execute(data)
    return jsonify(result)

@app.route('/status', methods=['GET'])
def status():
    return jsonify(agent.get_status())

if __name__ == '__main__':
    app.run(host='0.0.0.0', port={{PORT}})
`
    });

    // Web Scraping/Analysis Agent Template
    this.templates.set('web-analysis', {
      type: 'web-analysis',
      baseImage: 'python:3.11-slim',
      dependencies: ['beautifulsoup4', 'requests', 'selenium', 'redis', 'flask', 'openai', 'langchain'],
      codeTemplate: `
import os
import json
import redis
from flask import Flask, request, jsonify
from bs4 import BeautifulSoup
import requests
{{IMPORTS}}

app = Flask(__name__)
redis_client = redis.Redis(host=os.getenv('REDIS_HOST', 'redis'), port=6379, decode_responses=True)

{{AGENT_CODE}}

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "healthy", "agent": "{{AGENT_NAME}}"})

@app.route('/analyze', methods=['POST'])
def analyze():
    data = request.json
    result = agent.analyze(data.get('url') or data.get('content'))
    return jsonify(result)

@app.route('/scrape', methods=['POST'])
def scrape():
    data = request.json
    result = agent.scrape(data.get('url'), data.get('selectors'))
    return jsonify(result)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port={{PORT}})
`
    });

    // Content Generation Agent Template
    this.templates.set('content-generation', {
      type: 'content-generation',
      baseImage: 'node:20-slim',
      dependencies: ['express', 'openai', 'redis', 'marked', 'handlebars'],
      codeTemplate: `
const express = require('express');
const Redis = require('redis');
const OpenAI = require('openai');
const Handlebars = require('handlebars');
const marked = require('marked');
{{IMPORTS}}

const app = express();
app.use(express.json());

const redis = Redis.createClient({ url: process.env.REDIS_URL || 'redis://redis:6379' });
const openai = new OpenAI({ baseURL: process.env.AI_GATEWAY_URL, apiKey: process.env.OPENAI_API_KEY || 'dummy' });

{{AGENT_CODE}}

app.get('/health', (req, res) => res.json({ status: 'healthy', agent: '{{AGENT_NAME}}' }));
app.post('/generate', async (req, res) => {
  const result = await agent.generate(req.body);
  res.json(result);
});

const PORT = process.env.PORT || {{PORT}};
app.listen(PORT, () => console.log(\`{{AGENT_NAME}} running on port \${PORT}\`));
`
    });

    // Network/Security Expert Agent Template
    this.templates.set('network-expert', {
      type: 'network-expert',
      baseImage: 'python:3.11-slim',
      dependencies: ['paramiko', 'netmiko', 'requests', 'redis', 'flask', 'pyyaml', 'jinja2'],
      codeTemplate: `
import os
import json
import redis
from flask import Flask, request, jsonify
import yaml
{{IMPORTS}}

app = Flask(__name__)
redis_client = redis.Redis(host=os.getenv('REDIS_HOST', 'redis'), port=6379, decode_responses=True)

{{AGENT_CODE}}

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "healthy", "agent": "{{AGENT_NAME}}"})

@app.route('/query', methods=['POST'])
def query():
    data = request.json
    result = agent.query(data.get('question'))
    return jsonify(result)

@app.route('/configure', methods=['POST'])
def configure():
    data = request.json
    result = agent.configure(data.get('device'), data.get('config'))
    return jsonify(result)

@app.route('/analyze', methods=['POST'])
def analyze():
    data = request.json
    result = agent.analyze_config(data.get('config'))
    return jsonify(result)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port={{PORT}})
`
    });

    // Monitoring Agent Template
    this.templates.set('monitoring', {
      type: 'monitoring',
      baseImage: 'python:3.11-slim',
      dependencies: ['prometheus-client', 'requests', 'redis', 'flask', 'schedule', 'pandas'],
      codeTemplate: `
import os
import json
import redis
import schedule
import threading
from flask import Flask, request, jsonify
from prometheus_client import Counter, Gauge, generate_latest
{{IMPORTS}}

app = Flask(__name__)
redis_client = redis.Redis(host=os.getenv('REDIS_HOST', 'redis'), port=6379, decode_responses=True)

{{AGENT_CODE}}

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "healthy", "agent": "{{AGENT_NAME}}"})

@app.route('/metrics', methods=['GET'])
def metrics():
    return generate_latest()

@app.route('/status', methods=['GET'])
def status():
    return jsonify(agent.get_status())

def run_scheduler():
    while True:
        schedule.run_pending()
        time.sleep(1)

if __name__ == '__main__':
    threading.Thread(target=run_scheduler, daemon=True).start()
    app.run(host='0.0.0.0', port={{PORT}})
`
    });
  }

  /**
   * Create an agent from natural language description
   */
  async createAgent(description: string, userId?: string): Promise<AgentBlueprint> {
    const id = `agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Create initial blueprint
    const blueprint: AgentBlueprint = {
      id,
      name: '',
      description,
      type: 'single',
      capabilities: [],
      requiredServices: [],
      status: 'planning',
      createdAt: new Date()
    };
    
    this.blueprints.set(id, blueprint);
    await this.saveBlueprint(blueprint);

    // Start async creation process
    this.processAgentCreation(blueprint, userId).catch(err => {
      console.error('Agent creation failed:', err);
      blueprint.status = 'failed';
      blueprint.error = err.message;
      this.saveBlueprint(blueprint);
    });

    return blueprint;
  }

  /**
   * Main agent creation pipeline
   */
  private async processAgentCreation(blueprint: AgentBlueprint, userId?: string): Promise<void> {
    try {
      // Step 1: Analyze requirements with AI
      console.log(`[AgentFactory] Analyzing requirements for: ${blueprint.description}`);
      blueprint.status = 'planning';
      await this.analyzeRequirements(blueprint);
      await this.saveBlueprint(blueprint);

      // Step 2: Generate code
      console.log(`[AgentFactory] Generating code for: ${blueprint.name}`);
      blueprint.status = 'generating';
      await this.generateCode(blueprint);
      await this.saveBlueprint(blueprint);

      // Step 3: Build Docker image
      console.log(`[AgentFactory] Building Docker image for: ${blueprint.name}`);
      blueprint.status = 'building';
      await this.buildDockerImage(blueprint);
      await this.saveBlueprint(blueprint);

      // Step 4: Deploy
      console.log(`[AgentFactory] Deploying: ${blueprint.name}`);
      blueprint.status = 'deploying';
      await this.deployAgent(blueprint);
      
      blueprint.status = 'running';
      blueprint.deployedAt = new Date();
      await this.saveBlueprint(blueprint);

      console.log(`[AgentFactory] ✅ Agent deployed successfully: ${blueprint.name}`);
      
      // Notify via Redis
      await storage.publish('agent-created', JSON.stringify({
        id: blueprint.id,
        name: blueprint.name,
        endpoints: blueprint.endpoints
      }));

    } catch (error) {
      blueprint.status = 'failed';
      blueprint.error = error instanceof Error ? error.message : 'Unknown error';
      await this.saveBlueprint(blueprint);
      throw error;
    }
  }

  /**
   * Analyze requirements using AI
   */
  private async analyzeRequirements(blueprint: AgentBlueprint): Promise<void> {
    const prompt = `You are an expert system architect. Analyze this agent request and provide a detailed specification.

USER REQUEST: "${blueprint.description}"

Respond with a JSON object (no markdown, just JSON):
{
  "name": "kebab-case-name",
  "displayName": "Human Readable Name",
  "type": "single|multi-agent|pipeline",
  "category": "data-analysis|web-analysis|content-generation|network-expert|monitoring|custom",
  "capabilities": ["list", "of", "capabilities"],
  "requiredServices": ["redis", "postgres", "ollama", etc],
  "subAgents": [
    {
      "name": "sub-agent-name",
      "role": "What this sub-agent does",
      "capabilities": ["cap1", "cap2"],
      "inputs": ["what it receives"],
      "outputs": ["what it produces"]
    }
  ],
  "ports": [3000],
  "environment": {
    "KEY": "default_value"
  },
  "pythonDependencies": ["package1", "package2"],
  "nodeDependencies": ["package1", "package2"],
  "description": "Detailed description of what this agent does"
}`;

    try {
      const response = await aiGateway.chat([
        { role: 'system', content: 'You are an expert system architect. Respond only with valid JSON.' },
        { role: 'user', content: prompt }
      ]);

      const content = response.choices[0]?.message?.content || '{}';
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');
      
      const spec = JSON.parse(jsonMatch[0]);
      
      blueprint.name = spec.name || `agent-${blueprint.id}`;
      blueprint.type = spec.type || 'single';
      blueprint.capabilities = spec.capabilities || [];
      blueprint.requiredServices = spec.requiredServices || ['redis'];
      blueprint.subAgents = spec.subAgents;
      
      // Store additional metadata
      (blueprint as any).category = spec.category;
      (blueprint as any).displayName = spec.displayName;
      (blueprint as any).pythonDependencies = spec.pythonDependencies;
      (blueprint as any).nodeDependencies = spec.nodeDependencies;
      (blueprint as any).environment = spec.environment;
      (blueprint as any).ports = spec.ports || [3000];
      
    } catch (error) {
      console.error('AI analysis failed, using defaults:', error);
      blueprint.name = `custom-agent-${Date.now()}`;
      blueprint.capabilities = ['general'];
      blueprint.requiredServices = ['redis'];
    }
  }

  /**
   * Generate agent code using AI
   */
  private async generateCode(blueprint: AgentBlueprint): Promise<void> {
    const category = (blueprint as any).category || 'custom';
    const template = this.templates.get(category) || this.templates.get('data-analysis')!;
    const port = ((blueprint as any).ports || [3000])[0];
    
    // Generate the main agent code
    const codePrompt = `Generate Python code for an agent with these specifications:

NAME: ${blueprint.name}
DESCRIPTION: ${blueprint.description}
CAPABILITIES: ${blueprint.capabilities.join(', ')}
${blueprint.subAgents ? `SUB-AGENTS: ${JSON.stringify(blueprint.subAgents, null, 2)}` : ''}

Requirements:
1. Create a class called 'Agent' with methods for each capability
2. Include proper error handling
3. Use redis_client for caching/state
4. Include logging
5. Make it production-ready

Respond with ONLY the Python code for the Agent class, no explanations:`;

    let agentCode = '';
    try {
      const response = await aiGateway.chat([
        { role: 'system', content: 'You are an expert Python developer. Generate clean, production-ready code.' },
        { role: 'user', content: codePrompt }
      ]);
      
      agentCode = response.choices[0]?.message?.content || '';
      // Clean up markdown code blocks
      agentCode = agentCode.replace(/```python\n?/g, '').replace(/```\n?/g, '').trim();
    } catch {
      // Fallback to basic agent
      agentCode = this.generateFallbackCode(blueprint);
    }

    // Build the full file
    const mainFile = template.codeTemplate
      .replace('{{IMPORTS}}', '')
      .replace('{{AGENT_CODE}}', `${agentCode}\n\nagent = Agent()`)
      .replace(/\{\{AGENT_NAME\}\}/g, blueprint.name)
      .replace(/\{\{PORT\}\}/g, String(port));

    // Generate Dockerfile
    const dockerfile = this.generateDockerfile(blueprint, template);
    
    // Generate docker-compose addition
    const dockerCompose = this.generateDockerCompose(blueprint, port);

    blueprint.code = {
      mainFile,
      files: [
        { path: 'main.py', content: mainFile },
        { path: 'requirements.txt', content: template.dependencies.join('\n') + '\nflask\ngunicorn' }
      ],
      dockerfile,
      dockerCompose
    };
  }

  /**
   * Generate fallback code when AI fails
   */
  private generateFallbackCode(blueprint: AgentBlueprint): string {
    return `
import logging
import json
from datetime import datetime

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('${blueprint.name}')

class Agent:
    def __init__(self):
        self.name = '${blueprint.name}'
        self.capabilities = ${JSON.stringify(blueprint.capabilities)}
        self.status = 'initialized'
        self.metrics = {'requests': 0, 'errors': 0}
        logger.info(f'Agent {self.name} initialized')
    
    def execute(self, data):
        """Execute a task"""
        self.metrics['requests'] += 1
        try:
            task_type = data.get('type', 'default')
            logger.info(f'Executing task: {task_type}')
            
            # Store in Redis for persistence
            redis_client.hset(f'agent:{self.name}:tasks', 
                            str(datetime.now().timestamp()), 
                            json.dumps(data))
            
            return {
                'success': True,
                'agent': self.name,
                'task': task_type,
                'result': f'Task {task_type} completed',
                'timestamp': datetime.now().isoformat()
            }
        except Exception as e:
            self.metrics['errors'] += 1
            logger.error(f'Task failed: {e}')
            return {'success': False, 'error': str(e)}
    
    def get_status(self):
        """Get agent status"""
        return {
            'name': self.name,
            'status': self.status,
            'capabilities': self.capabilities,
            'metrics': self.metrics
        }
`;
  }

  /**
   * Generate Dockerfile
   */
  private generateDockerfile(blueprint: AgentBlueprint, template: AgentTemplate): string {
    const deps = (blueprint as any).pythonDependencies || template.dependencies;
    
    return `FROM ${template.baseImage}

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \\
    gcc \\
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Set environment
ENV PYTHONUNBUFFERED=1
ENV AGENT_NAME=${blueprint.name}

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \\
    CMD curl -f http://localhost:${((blueprint as any).ports || [3000])[0]}/health || exit 1

# Run with gunicorn for production
CMD ["gunicorn", "--bind", "0.0.0.0:${((blueprint as any).ports || [3000])[0]}", "--workers", "2", "main:app"]
`;
  }

  /**
   * Generate docker-compose service definition
   */
  private generateDockerCompose(blueprint: AgentBlueprint, port: number): string {
    const env = (blueprint as any).environment || {};
    const envLines = Object.entries(env)
      .map(([k, v]) => `      ${k}: "${v}"`)
      .join('\n');

    return `
  ${blueprint.name}:
    build:
      context: ./generated-agents/${blueprint.name}
      dockerfile: Dockerfile
    container_name: ${blueprint.name}
    ports:
      - "${port}:${port}"
    environment:
      REDIS_HOST: redis
      REDIS_URL: redis://redis:6379
      AI_GATEWAY_URL: http://nginx:8080/v1
      PORT: "${port}"
${envLines}
    networks:
      - lobe-network
    depends_on:
      redis:
        condition: service_healthy
    restart: unless-stopped
    labels:
      - "managed-by=agent-factory"
      - "created-at=${new Date().toISOString()}"
`;
  }

  /**
   * Build Docker image
   */
  private async buildDockerImage(blueprint: AgentBlueprint): Promise<void> {
    if (!blueprint.code) throw new Error('No code generated');

    // Create directory structure
    const agentDir = path.join(this.workDir, blueprint.name);
    await fs.mkdir(agentDir, { recursive: true });

    // Write all files
    for (const file of blueprint.code.files) {
      const filePath = path.join(agentDir, file.path);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, file.content);
    }

    // Write Dockerfile
    await fs.writeFile(path.join(agentDir, 'Dockerfile'), blueprint.code.dockerfile);

    // Build the image
    try {
      const { stdout, stderr } = await execAsync(
        `docker build -t ${blueprint.name}:latest ${agentDir}`,
        { timeout: 300000 } // 5 minute timeout
      );
      console.log('Docker build output:', stdout);
      if (stderr) console.warn('Docker build warnings:', stderr);
    } catch (error) {
      console.error('Docker build failed:', error);
      throw new Error(`Docker build failed: ${error}`);
    }
  }

  /**
   * Deploy the agent
   */
  private async deployAgent(blueprint: AgentBlueprint): Promise<void> {
    const port = ((blueprint as any).ports || [3000])[0];
    const env = (blueprint as any).environment || {};
    
    // Build environment args
    const envArgs = Object.entries({
      REDIS_HOST: 'redis',
      REDIS_URL: 'redis://redis:6379',
      AI_GATEWAY_URL: 'http://nginx:8080/v1',
      PORT: String(port),
      ...env
    }).map(([k, v]) => `-e ${k}="${v}"`).join(' ');

    // Run the container
    try {
      // Remove existing container if any
      await execAsync(`docker rm -f ${blueprint.name} 2>/dev/null || true`);
      
      // Run new container
      const { stdout } = await execAsync(
        `docker run -d \\
          --name ${blueprint.name} \\
          --network lobe-chat-full-stack_lobe-network \\
          -p ${port}:${port} \\
          ${envArgs} \\
          --restart unless-stopped \\
          --label "managed-by=agent-factory" \\
          ${blueprint.name}:latest`
      );
      
      const containerId = stdout.trim();
      console.log(`Container started: ${containerId}`);
      
      blueprint.endpoints = [`http://localhost:${port}`];
      
      // Register with orchestrator
      await this.registerAgent(blueprint);
      
    } catch (error) {
      console.error('Deploy failed:', error);
      throw new Error(`Deploy failed: ${error}`);
    }
  }

  /**
   * Register agent with the orchestrator
   */
  private async registerAgent(blueprint: AgentBlueprint): Promise<void> {
    const registration = {
      id: blueprint.id,
      name: blueprint.name,
      type: blueprint.type,
      capabilities: blueprint.capabilities,
      endpoints: blueprint.endpoints,
      status: 'running',
      createdAt: blueprint.createdAt,
      deployedAt: blueprint.deployedAt
    };

    await storage.set(`agents:${blueprint.id}`, JSON.stringify(registration));
    await storage.sadd('agents:active', blueprint.id);
    
    // Also store in the agents list
    const agents = JSON.parse(await storage.get('factory:agents') || '[]');
    agents.push(registration);
    await storage.set('factory:agents', JSON.stringify(agents));
  }

  /**
   * Save blueprint to storage
   */
  private async saveBlueprint(blueprint: AgentBlueprint): Promise<void> {
    await storage.set(`blueprints:${blueprint.id}`, JSON.stringify(blueprint));
  }

  /**
   * Get blueprint by ID
   */
  async getBlueprint(id: string): Promise<AgentBlueprint | null> {
    const data = await storage.get(`blueprints:${id}`);
    return data ? JSON.parse(data) : null;
  }

  /**
   * List all blueprints
   */
  async listBlueprints(): Promise<AgentBlueprint[]> {
    const keys = await storage.keys('blueprints:*');
    const blueprints: AgentBlueprint[] = [];
    
    for (const key of keys) {
      const data = await storage.get(key);
      if (data) blueprints.push(JSON.parse(data));
    }
    
    return blueprints.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  /**
   * List running agents
   */
  async listRunningAgents(): Promise<any[]> {
    try {
      const data = await storage.get('factory:agents');
      return JSON.parse(data || '[]');
    } catch {
      return [];
    }
  }

  /**
   * Stop an agent
   */
  async stopAgent(id: string): Promise<boolean> {
    const blueprint = await this.getBlueprint(id);
    if (!blueprint) return false;

    try {
      await execAsync(`docker stop ${blueprint.name}`);
      await execAsync(`docker rm ${blueprint.name}`);
      
      blueprint.status = 'failed';
      await this.saveBlueprint(blueprint);
      
      await storage.delete(`agents:${id}`);
      
      return true;
    } catch (error) {
      console.error('Stop failed:', error);
      return false;
    }
  }

  /**
   * Get agent logs
   */
  async getAgentLogs(id: string, lines: number = 100): Promise<string> {
    const blueprint = await this.getBlueprint(id);
    if (!blueprint) return 'Agent not found';

    try {
      const { stdout } = await execAsync(`docker logs --tail ${lines} ${blueprint.name}`);
      return stdout;
    } catch (error) {
      return `Failed to get logs: ${error}`;
    }
  }

  /**
   * Execute task on a specific agent
   */
  async executeOnAgent(agentId: string, task: any): Promise<any> {
    const blueprint = await this.getBlueprint(agentId);
    if (!blueprint || !blueprint.endpoints?.[0]) {
      throw new Error('Agent not found or not running');
    }

    const response = await fetch(`${blueprint.endpoints[0]}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task)
    });

    return response.json();
  }
}

// Export singleton
export const agentFactory = new AgentFactory(
  process.env.GENERATED_AGENTS_DIR || '/app/generated-agents'
);
