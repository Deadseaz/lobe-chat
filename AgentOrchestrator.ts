/**
 * AgentOrchestrator - The brain of the multi-agent system
 * Handles task delegation, agent coordination, and system-level decision making
 */

import { BaseAgent } from './BaseAgent';
import {
  AgentType,
  AgentTask,
  TaskResult,
  AgentMetadata,
  AgentMessage,
  MessageType,
  TaskStatus,
  TaskPriority,
  AgentStatus,
  CoordinationRequest,
  CoordinationResponse,
  AgentCapability
} from './types';

export interface OrchestratorConfig {
  maxConcurrentTasks: number;
  taskTimeout: number; // milliseconds
  retryAttempts: number;
  loadBalancingStrategy: 'round-robin' | 'least-busy' | 'capability-match' | 'performance';
}

export class AgentOrchestrator extends BaseAgent {
  private registeredAgents: Map<string, AgentMetadata> = new Map();
  private activeTasks: Map<string, AgentTask> = new Map();
  // taskQueue is inherited from BaseAgent as protected
  private config: OrchestratorConfig;
  private roundRobinIndex: number = 0;

  constructor(context: any, config?: Partial<OrchestratorConfig>) {
    const capabilities: AgentCapability[] = [
      {
        name: 'task-delegation',
        description: 'Delegate tasks to specialized agents',
        requiredServices: []
      },
      {
        name: 'agent-coordination',
        description: 'Coordinate multiple agents for complex workflows',
        requiredServices: []
      },
      {
        name: 'load-balancing',
        description: 'Balance workload across available agents',
        requiredServices: []
      }
    ];

    super('orchestrator-001', 'Orchestrator', AgentType.ORCHESTRATOR, capabilities, context);

    this.config = {
      maxConcurrentTasks: config?.maxConcurrentTasks || 50,
      taskTimeout: config?.taskTimeout || 300000, // 5 minutes
      retryAttempts: config?.retryAttempts || 3,
      loadBalancingStrategy: config?.loadBalancingStrategy || 'capability-match'
    };

    // Setup orchestrator-specific message handlers
    this.setupOrchestratorHandlers();
  }

  /**
   * Initialize orchestrator - discover and register agents
   */
  protected async onInitialize(): Promise<void> {
    console.log('[Orchestrator] Starting agent discovery...');

    // Request all agents to announce themselves
    await this.sendMessage(
      'broadcast',
      MessageType.QUERY,
      { type: 'status', requestId: 'discovery' }
    );

    // Wait for responses
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log(`[Orchestrator] Discovered ${this.registeredAgents.size} agents`);
  }

  /**
   * Submit a task to the orchestrator for delegation
   */
  async submitTask(task: AgentTask): Promise<string> {
    // Validate task
    if (!task.id) {
      task.id = this.generateTaskId();
    }

    if (!task.createdAt) {
      task.createdAt = new Date();
    }

    task.status = TaskStatus.PENDING;
    task.createdBy = 'orchestrator';

    console.log(`[Orchestrator] Task submitted: ${task.id} - ${task.type}`);

    // Add to queue
    this.taskQueue.push(task);
    this.activeTasks.set(task.id, task);

    // Process queue
    await this.processTaskQueue();

    return task.id;
  }

  /**
   * Get task status
   */
  async getTaskStatus(taskId: string): Promise<AgentTask | null> {
    return this.activeTasks.get(taskId) || null;
  }

  /**
   * Get all registered agents
   */
  getRegisteredAgents(): AgentMetadata[] {
    return Array.from(this.registeredAgents.values());
  }

  /**
   * Get system health status
   */
  getSystemHealth(): {
    totalAgents: number;
    activeAgents: number;
    idleAgents: number;
    busyAgents: number;
    errorAgents: number;
    activeTasks: number;
    queuedTasks: number;
  } {
    const agents = Array.from(this.registeredAgents.values());

    return {
      totalAgents: agents.length,
      activeAgents: agents.filter(a => a.status !== AgentStatus.OFFLINE).length,
      idleAgents: agents.filter(a => a.status === AgentStatus.IDLE).length,
      busyAgents: agents.filter(a => a.status === AgentStatus.BUSY).length,
      errorAgents: agents.filter(a => a.status === AgentStatus.ERROR).length,
      activeTasks: this.activeTasks.size,
      queuedTasks: this.taskQueue.length
    };
  }

  /**
   * Execute task - orchestrator delegates, doesn't execute directly
   */
  protected async executeTask(task: AgentTask): Promise<TaskResult> {
    try {
      // Find suitable agent
      const agent = await this.selectAgentForTask(task);

      if (!agent) {
        return {
          success: false,
          error: 'No suitable agent available for task'
        };
      }

      console.log(`[Orchestrator] Delegating task ${task.id} to agent ${agent.name}`);

      // Delegate task
      task.status = TaskStatus.ASSIGNED;
      task.assignedTo = agent.id;

      const correlationId = this.generateCorrelationId();

      // Send task to agent
      await this.sendMessage(
        agent.id,
        MessageType.TASK_REQUEST,
        task,
        correlationId
      );

      // Wait for response with timeout
      const result = await this.waitForTaskResponse(task.id, correlationId, this.config.taskTimeout);

      return result;

    } catch (error) {
      console.error(`[Orchestrator] Error executing task ${task.id}:`, error);

      // Handle retries
      if (!task.retries) task.retries = 0;
      if (task.retries < this.config.retryAttempts) {
        task.retries++;
        task.status = TaskStatus.PENDING;
        console.log(`[Orchestrator] Retrying task ${task.id} (attempt ${task.retries})`);
        return this.executeTask(task);
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private setupOrchestratorHandlers(): void {
    this.messageHandlers.set(MessageType.AGENT_STATUS, this.handleAgentStatus.bind(this));
    this.messageHandlers.set(MessageType.TASK_RESPONSE, this.handleTaskResponse.bind(this));
  }

  private async handleAgentStatus(message: AgentMessage): Promise<void> {
    const agentData = message.payload as AgentMetadata | any;

    // Register or update agent
    if (agentData.agentId || agentData.id) {
      const agentId = agentData.agentId || agentData.id;

      const existingAgent = this.registeredAgents.get(agentId);

      const agentMetadata: AgentMetadata = existingAgent ? {
        ...existingAgent,
        status: agentData.status,
        lastHeartbeat: new Date()
      } : {
        id: agentId,
        name: agentData.name || agentId,
        type: agentData.type || AgentType.INFRASTRUCTURE,
        version: agentData.version || '1.0.0',
        capabilities: agentData.capabilities || [],
        status: agentData.status || AgentStatus.IDLE,
        createdAt: new Date(),
        lastHeartbeat: new Date(),
        tasksCompleted: agentData.tasksCompleted || 0,
        tasksAssigned: agentData.tasksAssigned || 0,
        tasksFailed: agentData.tasksFailed || 0,
        averageResponseTime: agentData.averageResponseTime || 0
      };

      this.registeredAgents.set(agentId, agentMetadata);

      console.log(`[Orchestrator] Agent registered/updated: ${agentMetadata.name} (${agentMetadata.status})`);
    }
  }

  private async handleTaskResponse(message: AgentMessage): Promise<void> {
    const { taskId, result } = message.payload;

    const task = this.activeTasks.get(taskId);
    if (task) {
      task.result = result;
      task.status = result.success ? TaskStatus.COMPLETED : TaskStatus.FAILED;
      task.completedAt = new Date();

      console.log(`[Orchestrator] Task ${taskId} completed: ${result.success ? 'SUCCESS' : 'FAILED'}`);

      // Update agent metrics
      const agent = this.registeredAgents.get(message.from);
      if (agent) {
        if (result.success) {
          agent.tasksCompleted++;
        } else {
          agent.tasksFailed++;
        }
      }

      // Remove from active tasks after a delay (for status queries)
      setTimeout(() => {
        this.activeTasks.delete(taskId);
      }, 60000); // Keep for 1 minute
    }
  }

  private async processTaskQueue(): Promise<void> {
    while (this.taskQueue.length > 0 && this.activeTasks.size < this.config.maxConcurrentTasks) {
      const task = this.taskQueue.shift();
      if (task) {
        // Process task asynchronously
        this.executeTask(task).catch(err =>
          console.error(`[Orchestrator] Error processing task ${task.id}:`, err)
        );
      }
    }
  }

  private async selectAgentForTask(task: AgentTask): Promise<AgentMetadata | null> {
    const availableAgents = Array.from(this.registeredAgents.values())
      .filter(agent =>
        agent.status === AgentStatus.IDLE || agent.status === AgentStatus.BUSY
      );

    if (availableAgents.length === 0) {
      return null;
    }

    switch (this.config.loadBalancingStrategy) {
      case 'round-robin':
        return this.selectRoundRobin(availableAgents);

      case 'least-busy':
        return this.selectLeastBusy(availableAgents);

      case 'capability-match':
        return this.selectByCapability(availableAgents, task);

      case 'performance':
        return this.selectByPerformance(availableAgents, task);

      default:
        return availableAgents[0];
    }
  }

  private selectRoundRobin(agents: AgentMetadata[]): AgentMetadata {
    const agent = agents[this.roundRobinIndex % agents.length];
    this.roundRobinIndex++;
    return agent;
  }

  private selectLeastBusy(agents: AgentMetadata[]): AgentMetadata {
    return agents.reduce((least, current) => {
      const leastLoad = least.tasksAssigned - least.tasksCompleted;
      const currentLoad = current.tasksAssigned - current.tasksCompleted;
      return currentLoad < leastLoad ? current : least;
    });
  }

  private selectByCapability(agents: AgentMetadata[], task: AgentTask): AgentMetadata | null {
    if (!task.requiredCapabilities || task.requiredCapabilities.length === 0) {
      return this.selectLeastBusy(agents);
    }

    // Filter agents that have required capabilities
    const capableAgents = agents.filter(agent => {
      const agentCapabilityNames = agent.capabilities.map(c => c.name);
      return task.requiredCapabilities!.every(required =>
        agentCapabilityNames.includes(required)
      );
    });

    if (capableAgents.length === 0) {
      return null;
    }

    // Select least busy among capable agents
    return this.selectLeastBusy(capableAgents);
  }

  private selectByPerformance(agents: AgentMetadata[], task: AgentTask): AgentMetadata {
    // Score agents based on success rate and response time
    const scoredAgents = agents.map(agent => {
      const totalTasks = agent.tasksCompleted + agent.tasksFailed;
      const successRate = totalTasks > 0 ? agent.tasksCompleted / totalTasks : 0.5;
      const responseTimeScore = agent.averageResponseTime > 0 ? 1 / agent.averageResponseTime : 1;

      // Combined score (weighted)
      const score = (successRate * 0.7) + (responseTimeScore * 0.3);

      return { agent, score };
    });

    // Sort by score descending
    scoredAgents.sort((a, b) => b.score - a.score);

    return scoredAgents[0].agent;
  }

  private async waitForTaskResponse(taskId: string, correlationId: string, timeout: number): Promise<TaskResult> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      const checkInterval = setInterval(() => {
        const task = this.activeTasks.get(taskId);

        if (task && task.result) {
          clearInterval(checkInterval);
          resolve(task.result);
        } else if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval);
          reject(new Error(`Task ${taskId} timed out after ${timeout}ms`));
        }
      }, 100);
    });
  }

  private generateTaskId(): string {
    return `task-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  private generateCorrelationId(): string {
    return `corr-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }
}
