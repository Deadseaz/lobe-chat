/**
 * BaseAgent - Abstract base class for all agents in the multi-agent system
 * Provides core functionality: lifecycle management, message handling, task processing
 */

import {
  AgentType,
  AgentStatus,
  AgentCapability,
  AgentMetadata,
  AgentTask,
  TaskResult,
  AgentMessage,
  MessageType,
  AgentContext,
  TaskStatus,
  TaskPriority
} from './types';

export abstract class BaseAgent {
  protected metadata: AgentMetadata;
  protected context: AgentContext;
  protected currentTask: AgentTask | null = null;
  protected taskQueue: AgentTask[] = [];
  protected messageHandlers: Map<MessageType, (msg: AgentMessage) => Promise<void>>;
  protected heartbeatInterval: any;
  protected isShuttingDown: boolean = false;

  constructor(
    id: string,
    name: string,
    type: AgentType,
    capabilities: AgentCapability[],
    context: AgentContext
  ) {
    this.metadata = {
      id,
      name,
      type,
      version: '1.0.0',
      capabilities,
      status: AgentStatus.INITIALIZING,
      createdAt: new Date(),
      lastHeartbeat: new Date(),
      tasksCompleted: 0,
      tasksAssigned: 0,
      tasksFailed: 0,
      averageResponseTime: 0
    };

    this.context = context;
    this.messageHandlers = new Map();
    this.setupDefaultMessageHandlers();
  }

  /**
   * Initialize the agent - must be called after construction
   */
  async initialize(): Promise<void> {
    try {
      console.log(`[${this.metadata.name}] Initializing...`);

      // Load persisted state if available
      await this.loadState();

      // Initialize agent-specific resources
      await this.onInitialize();

      // Register with message bus
      await this.registerWithMessageBus();

      // Start heartbeat
      this.startHeartbeat();

      this.metadata.status = AgentStatus.IDLE;
      console.log(`[${this.metadata.name}] Initialized successfully`);

      // Announce presence
      await this.broadcastStatus();
    } catch (error) {
      console.error(`[${this.metadata.name}] Initialization failed:`, error);
      this.metadata.status = AgentStatus.ERROR;
      throw error;
    }
  }

  /**
   * Process a task - main entry point for task execution
   */
  async processTask(task: AgentTask): Promise<TaskResult> {
    const startTime = Date.now();

    try {
      // Validate task
      if (!this.canHandleTask(task)) {
        return {
          success: false,
          error: `Agent ${this.metadata.name} cannot handle task type: ${task.type}`
        };
      }

      // Update status
      this.currentTask = task;
      this.metadata.status = AgentStatus.BUSY;
      task.status = TaskStatus.IN_PROGRESS;
      task.startedAt = new Date();
      task.assignedTo = this.metadata.id;

      console.log(`[${this.metadata.name}] Processing task ${task.id}: ${task.type}`);

      // Execute task
      const result = await this.executeTask(task);

      // Update metrics
      const executionTime = Date.now() - startTime;
      this.updateMetrics(true, executionTime);

      // Update task
      task.status = result.success ? TaskStatus.COMPLETED : TaskStatus.FAILED;
      task.completedAt = new Date();
      task.result = result;

      console.log(`[${this.metadata.name}] Task ${task.id} completed: ${result.success ? 'SUCCESS' : 'FAILED'}`);

      // Clear current task and update status
      this.currentTask = null;
      this.metadata.status = this.taskQueue.length > 0 ? AgentStatus.BUSY : AgentStatus.IDLE;

      // Save state
      await this.saveState();

      return result;

    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.updateMetrics(false, executionTime);

      console.error(`[${this.metadata.name}] Task execution error:`, error);

      task.status = TaskStatus.FAILED;
      task.completedAt = new Date();

      this.currentTask = null;
      this.metadata.status = AgentStatus.ERROR;

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        metadata: {
          executionTime
        }
      };
    }
  }

  /**
   * Send a message to another agent or broadcast
   */
  async sendMessage(to: string | string[], type: MessageType, payload: any, correlationId?: string): Promise<void> {
    const message: AgentMessage = {
      id: this.generateId(),
      type,
      from: this.metadata.id,
      to,
      payload,
      timestamp: new Date(),
      correlationId
    };

    await this.context.messageBus.publish(message);
  }

  /**
   * Handle incoming message
   */
  async handleMessage(message: AgentMessage): Promise<void> {
    try {
      // Check if message is for this agent
      if (message.to !== this.metadata.id &&
          message.to !== 'broadcast' &&
          !Array.isArray(message.to)) {
        return;
      }

      const handler = this.messageHandlers.get(message.type);
      if (handler) {
        await handler.call(this, message);
      } else {
        console.warn(`[${this.metadata.name}] No handler for message type: ${message.type}`);
      }
    } catch (error) {
      console.error(`[${this.metadata.name}] Error handling message:`, error);
    }
  }

  /**
   * Check if agent can handle a specific task
   */
  canHandleTask(task: AgentTask): boolean {
    if (!task.requiredCapabilities || task.requiredCapabilities.length === 0) {
      return true;
    }

    const agentCapabilityNames = this.metadata.capabilities.map(c => c.name);
    return task.requiredCapabilities.every(required =>
      agentCapabilityNames.includes(required)
    );
  }

  /**
   * Get agent metadata
   */
  getMetadata(): AgentMetadata {
    return { ...this.metadata };
  }

  /**
   * Get agent status
   */
  getStatus(): AgentStatus {
    return this.metadata.status;
  }

  /**
   * Shutdown agent gracefully
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    console.log(`[${this.metadata.name}] Shutting down...`);

    // Stop accepting new tasks
    this.metadata.status = AgentStatus.MAINTENANCE;

    // Wait for current task to complete
    if (this.currentTask) {
      console.log(`[${this.metadata.name}] Waiting for current task to complete...`);
      // Wait up to 30 seconds
      const timeout = 30000;
      const startTime = Date.now();
      while (this.currentTask && (Date.now() - startTime) < timeout) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Stop heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Cleanup
    await this.onShutdown();

    // Save final state
    await this.saveState();

    this.metadata.status = AgentStatus.OFFLINE;
    console.log(`[${this.metadata.name}] Shutdown complete`);
  }

  // ============================================================================
  // Protected Methods - To be implemented by subclasses
  // ============================================================================

  /**
   * Execute the actual task logic - must be implemented by subclasses
   */
  protected abstract executeTask(task: AgentTask): Promise<TaskResult>;

  /**
   * Agent-specific initialization logic
   */
  protected async onInitialize(): Promise<void> {
    // Override in subclasses if needed
  }

  /**
   * Agent-specific shutdown logic
   */
  protected async onShutdown(): Promise<void> {
    // Override in subclasses if needed
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private setupDefaultMessageHandlers(): void {
    this.messageHandlers.set(MessageType.TASK_REQUEST, this.handleTaskRequest.bind(this));
    this.messageHandlers.set(MessageType.QUERY, this.handleQuery.bind(this));
    this.messageHandlers.set(MessageType.COORDINATION, this.handleCoordination.bind(this));
  }

  private async handleTaskRequest(message: AgentMessage): Promise<void> {
    const task = message.payload as AgentTask;

    if (this.metadata.status === AgentStatus.IDLE || this.taskQueue.length < 10) {
      this.metadata.tasksAssigned++;
      this.taskQueue.push(task);

      // Process immediately if idle
      if (this.metadata.status === AgentStatus.IDLE) {
        const nextTask = this.taskQueue.shift();
        if (nextTask) {
          const result = await this.processTask(nextTask);

          // Send result back
          await this.sendMessage(
            message.from,
            MessageType.TASK_RESPONSE,
            { taskId: task.id, result },
            message.correlationId
          );
        }
      }
    }
  }

  private async handleQuery(message: AgentMessage): Promise<void> {
    const query = message.payload;

    if (query.type === 'status') {
      await this.sendMessage(
        message.from,
        MessageType.AGENT_STATUS,
        this.metadata,
        message.correlationId
      );
    } else if (query.type === 'capabilities') {
      await this.sendMessage(
        message.from,
        MessageType.TASK_RESPONSE,
        { capabilities: this.metadata.capabilities },
        message.correlationId
      );
    }
  }

  private async handleCoordination(message: AgentMessage): Promise<void> {
    // Override in subclasses for agent-specific coordination
  }

  private async registerWithMessageBus(): Promise<void> {
    await this.context.messageBus.subscribe(this.metadata.id, this.handleMessage.bind(this));
    await this.context.messageBus.subscribe('broadcast', this.handleMessage.bind(this));
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(async () => {
      this.metadata.lastHeartbeat = new Date();
      await this.saveState();
    }, 30000); // Every 30 seconds
  }

  private async broadcastStatus(): Promise<void> {
    await this.sendMessage(
      'broadcast',
      MessageType.AGENT_STATUS,
      {
        agentId: this.metadata.id,
        status: this.metadata.status,
        capabilities: this.metadata.capabilities
      }
    );
  }

  private updateMetrics(success: boolean, executionTime: number): void {
    if (success) {
      this.metadata.tasksCompleted++;
    } else {
      this.metadata.tasksFailed++;
    }

    // Update average response time
    const totalTasks = this.metadata.tasksCompleted + this.metadata.tasksFailed;
    this.metadata.averageResponseTime =
      ((this.metadata.averageResponseTime * (totalTasks - 1)) + executionTime) / totalTasks;
  }

  private async loadState(): Promise<void> {
    try {
      if (this.context.storage) {
        const state = await this.context.storage.get(`agent:${this.metadata.id}`);
        if (state) {
          this.metadata = { ...this.metadata, ...state };
        }
      }
    } catch (error) {
      console.warn(`[${this.metadata.name}] Could not load state:`, error);
    }
  }

  private async saveState(): Promise<void> {
    try {
      if (this.context.storage) {
        await this.context.storage.put(`agent:${this.metadata.id}`, this.metadata);
      }
    } catch (error) {
      console.warn(`[${this.metadata.name}] Could not save state:`, error);
    }
  }

  protected generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }
}
