/**
 * Sub-Agent Management Service
 * Manages the lifecycle of sub-agents including creation, deployment, monitoring, and termination
 */

import { Context } from 'hono';
import { AgentTask, TaskResult, AgentType } from '../agents/types';
import { DockerService } from './docker-service';

export interface SubAgentConfig {
  id: string;
  name: string;
  type: AgentType;
  image: string;
  tag?: string;
  environment: Record<string, string>;
  resources?: {
    cpu?: string;
    memory?: string;
  };
  network?: string;
  volumes?: Array<{ host: string; container: string }>;
  ports?: Array<{ container: number; host: number }>;
  capabilities?: string[];
  parentId?: string;
  createdAt: Date;
  status: 'pending' | 'deploying' | 'running' | 'stopped' | 'failed';
}

export interface SubAgentDeploymentResult {
  success: boolean;
  agentId: string;
  containerId?: string;
  error?: string;
  logs: string[];
}

export interface SubAgentHealthCheck {
  agentId: string;
  status: 'healthy' | 'unhealthy' | 'unknown';
  responseTime?: number;
  lastCheck: Date;
  details?: any;
}

export class SubAgentManagerService {
  private agents: Map<string, SubAgentConfig> = new Map();
  private dockerService: DockerService;
  private healthChecks: Map<string, SubAgentHealthCheck> = new Map();
  private monitoringInterval: number;

  constructor(dockerService: DockerService, monitoringInterval: number = 30000) { // 30 seconds
    this.dockerService = dockerService;
    this.monitoringInterval = monitoringInterval;
    this.startHealthMonitoring();
  }

  /**
   * Create a new sub-agent configuration
   */
  async createSubAgent(config: Omit<SubAgentConfig, 'id' | 'createdAt' | 'status'>): Promise<SubAgentConfig> {
    const agentId = crypto.randomUUID?.() || `subagent-${Date.now()}`;
    
    const newAgent: SubAgentConfig = {
      ...config,
      id: agentId,
      createdAt: new Date(),
      status: 'pending'
    };

    this.agents.set(agentId, newAgent);
    return newAgent;
  }

  /**
   * Deploy a sub-agent to the infrastructure
   */
  async deploySubAgent(agentId: string): Promise<SubAgentDeploymentResult> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return {
        success: false,
        agentId,
        error: `Agent with ID ${agentId} not found`,
        logs: [`Agent with ID ${agentId} not found`]
      };
    }

    const logs: string[] = [];
    logs.push(`Starting deployment for agent ${agent.name} (${agentId})`);

    try {
      // Update status to deploying
      agent.status = 'deploying';
      this.agents.set(agentId, agent);

      // Build image name
      const image = agent.tag ? `${agent.image}:${agent.tag}` : agent.image;

      // Pull the image
      logs.push(`Pulling image: ${image}`);
      const pullResult = await this.dockerService.pullImage(image);
      logs.push(pullResult.message);

      if (!pullResult.success) {
        throw new Error(`Failed to pull image: ${pullResult.message}`);
      }

      // Configure container
      const containerConfig = {
        image: image,
        name: agent.name,
        env: agent.environment,
        ports: agent.ports?.map(p => `${p.host}:${p.container}`) || [],
        volumes: agent.volumes?.map(v => `${v.host}:${v.container}`) || [],
        network: agent.network
      };

      logs.push(`Starting container for agent ${agent.name}`);
      const runResult = await this.dockerService.startContainer(containerConfig);

      if (runResult.success && runResult.id) {
        // Update agent with container ID and status
        agent.status = 'running';
        this.agents.set(agentId, agent);

        logs.push(`Agent deployed successfully with container ID: ${runResult.id}`);

        // Start health monitoring for this agent
        this.scheduleHealthCheck(agentId);

        return {
          success: true,
          agentId,
          containerId: runResult.id,
          logs
        };
      } else {
        throw new Error(`Failed to start container: ${runResult.message}`);
      }
    } catch (error) {
      agent.status = 'failed';
      this.agents.set(agentId, agent);

      logs.push(`Deployment failed: ${error instanceof Error ? error.message : 'Unknown error'}`);

      return {
        success: false,
        agentId,
        error: error instanceof Error ? error.message : 'Unknown error',
        logs
      };
    }
  }

  /**
   * Terminate a sub-agent
   */
  async terminateSubAgent(agentId: string): Promise<{ success: boolean; error?: string }> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return { success: false, error: `Agent with ID ${agentId} not found` };
    }

    try {
      // Stop the container
      await this.dockerService.stopContainer({ containerId: agentId });
      
      // Update status
      agent.status = 'stopped';
      this.agents.set(agentId, agent);

      // Remove from health checks
      this.healthChecks.delete(agentId);

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Get sub-agent by ID
   */
  getSubAgent(agentId: string): SubAgentConfig | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get all sub-agents
   */
  getAllSubAgents(): SubAgentConfig[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get sub-agent health status
   */
  getSubAgentHealth(agentId: string): SubAgentHealthCheck | undefined {
    return this.healthChecks.get(agentId);
  }

  /**
   * Get all sub-agent health statuses
   */
  getAllSubAgentHealth(): SubAgentHealthCheck[] {
    return Array.from(this.healthChecks.values());
  }

  /**
   * Start health monitoring for all agents
   */
  private startHealthMonitoring(): void {
    setInterval(() => {
      this.performHealthChecks();
    }, this.monitoringInterval);
  }

  /**
   * Schedule a health check for a specific agent
   */
  private scheduleHealthCheck(agentId: string): void {
    // Perform initial check
    this.checkAgentHealth(agentId);
  }

  /**
   * Perform health checks for all active agents
   */
  private async performHealthChecks(): Promise<void> {
    for (const agentId of this.agents.keys()) {
      await this.checkAgentHealth(agentId);
    }
  }

  /**
   * Check the health of a specific agent
   */
  private async checkAgentHealth(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent || !['running'].includes(agent.status)) {
      return;
    }

    try {
      // In a real implementation, this would make an actual health check request to the agent
      // For now, we'll simulate a response
      const startTime = Date.now();
      
      // Simulate health check (in real implementation, this would call the agent's health endpoint)
      await new Promise(resolve => setTimeout(resolve, 100)); // Simulate network delay
      
      const responseTime = Date.now() - startTime;
      
      const healthCheck: SubAgentHealthCheck = {
        agentId,
        status: 'healthy', // In a real implementation, this would be determined by the actual check
        responseTime,
        lastCheck: new Date(),
        details: {
          uptime: Math.floor((Date.now() - agent.createdAt.getTime()) / 1000)
        }
      };

      this.healthChecks.set(agentId, healthCheck);
    } catch (error) {
      const healthCheck: SubAgentHealthCheck = {
        agentId,
        status: 'unhealthy',
        lastCheck: new Date(),
        details: {
          error: error instanceof Error ? error.message : 'Health check failed'
        }
      };

      this.healthChecks.set(agentId, healthCheck);
    }
  }

  /**
   * Scale sub-agents based on load
   */
  async scaleSubAgents(agentType: AgentType, targetCount: number): Promise<{ success: boolean; message: string }> {
    const currentAgents = Array.from(this.agents.values())
      .filter(agent => agent.type === agentType && agent.status === 'running');

    const currentCount = currentAgents.length;

    if (targetCount > currentCount) {
      // Need to scale up
      const toCreate = targetCount - currentCount;
      const logs: string[] = [];

      for (let i = 0; i < toCreate; i++) {
        // Create a new agent based on a template for this type
        const templateAgent = this.getTemplateForType(agentType);
        if (templateAgent) {
          const newAgent = await this.createSubAgent(templateAgent);
          const result = await this.deploySubAgent(newAgent.id);
          logs.push(`Created and deployed agent ${newAgent.name}: ${result.success ? 'SUCCESS' : result.error || 'UNKNOWN'}`);
        }
      }

      return {
        success: true,
        message: `Scaled up ${agentType} agents from ${currentCount} to ${targetCount}. Created ${toCreate} agents. ${logs.join('; ')}`
      };
    } else if (targetCount < currentCount) {
      // Need to scale down
      const toRemove = currentCount - targetCount;
      const agentsToRemove = currentAgents
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()) // Remove oldest first
        .slice(0, toRemove);

      for (const agent of agentsToRemove) {
        await this.terminateSubAgent(agent.id);
      }

      return {
        success: true,
        message: `Scaled down ${agentType} agents from ${currentCount} to ${targetCount}. Removed ${toRemove} agents.`
      };
    } else {
      // Already at target count
      return {
        success: true,
        message: `${agentType} agents already at target count of ${targetCount}`
      };
    }
  }

  /**
   * Get template configuration for agent type
   */
  private getTemplateForType(agentType: AgentType): Omit<SubAgentConfig, 'id' | 'createdAt' | 'status'> | null {
    // Default templates for different agent types
    switch (agentType) {
      case AgentType.INFRASTRUCTURE:
        return {
          name: `infra-agent-${Date.now()}`,
          type: AgentType.INFRASTRUCTURE,
          image: 'zagent/infrastructure-agent',
          tag: 'latest',
          environment: {
            'AGENT_ROLE': 'infrastructure',
            'CF_API_TOKEN': process.env.CF_API_TOKEN || '',
            'CF_ACCOUNT_ID': process.env.CF_ACCOUNT_ID || ''
          },
          resources: {
            cpu: '0.5',
            memory: '512m'
          },
          capabilities: ['ssh', 'docker', 'server-health-check']
        };
      
      case AgentType.KNOWLEDGE:
        return {
          name: `knowledge-agent-${Date.now()}`,
          type: AgentType.KNOWLEDGE,
          image: 'zagent/knowledge-agent',
          tag: 'latest',
          environment: {
            'AGENT_ROLE': 'knowledge',
            'VECTOR_SERVICE_URL': process.env.VECTOR_SERVICE_URL || '',
            'AI_GATEWAY_URL': process.env.CF_GATEWAY_URL || ''
          },
          resources: {
            cpu: '0.5',
            memory: '1g'
          },
          capabilities: ['knowledge-query', 'document-embedding', 'semantic-search']
        };
      
      case AgentType.MONITORING:
        return {
          name: `monitoring-agent-${Date.now()}`,
          type: AgentType.MONITORING,
          image: 'zagent/monitoring-agent',
          tag: 'latest',
          environment: {
            'AGENT_ROLE': 'monitoring',
            'PROMETHEUS_URL': process.env.PROMETHEUS_URL || 'http://prometheus:9090',
            'GRAFANA_URL': process.env.GRAFANA_URL || 'http://grafana:3000'
          },
          resources: {
            cpu: '0.5',
            memory: '512m'
          },
          capabilities: ['metrics-collection', 'alerting', 'dashboard']
        };
      
      default:
        return null;
    }
  }

  /**
   * Get system metrics
   */
  getSystemMetrics(): {
    totalAgents: number;
    runningAgents: number;
    healthyAgents: number;
    unhealthyAgents: number;
    agentTypes: Record<string, number>;
  } {
    const agents = Array.from(this.agents.values());
    const healthChecks = Array.from(this.healthChecks.values());

    return {
      totalAgents: agents.length,
      runningAgents: agents.filter(a => a.status === 'running').length,
      healthyAgents: healthChecks.filter(h => h.status === 'healthy').length,
      unhealthyAgents: healthChecks.filter(h => h.status === 'unhealthy').length,
      agentTypes: agents.reduce((acc, agent) => {
        acc[agent.type] = (acc[agent.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    };
  }
}

/**
 * Initialize Sub-Agent Manager service middleware
 */
export const initializeSubAgentManager = async (c: Context, next: () => Promise<void>) => {
  const dockerService = c.get('dockerService');

  if (!dockerService) {
    console.error('Docker service not initialized for sub-agent management');
    throw new Error('Docker service required for sub-agent management');
  }

  const subAgentManager = new SubAgentManagerService(dockerService);
  c.set('subAgentManager', subAgentManager);

  await next();
};