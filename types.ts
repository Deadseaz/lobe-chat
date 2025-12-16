/**
 * Core Types for Multi-Agent System
 */

export enum AgentType {
  ORCHESTRATOR = 'orchestrator',
  INFRASTRUCTURE = 'infrastructure',
  DEPLOYMENT = 'deployment',
  MONITORING = 'monitoring',
  SECURITY = 'security',
  KNOWLEDGE = 'knowledge',
  COMMUNICATION = 'communication'
}

export enum AgentStatus {
  INITIALIZING = 'initializing',
  IDLE = 'idle',
  BUSY = 'busy',
  ERROR = 'error',
  MAINTENANCE = 'maintenance',
  OFFLINE = 'offline'
}

export enum TaskPriority {
  CRITICAL = 5,
  HIGH = 4,
  NORMAL = 3,
  LOW = 2,
  BACKGROUND = 1
}

export enum TaskStatus {
  PENDING = 'pending',
  ASSIGNED = 'assigned',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

export enum MessageType {
  TASK_REQUEST = 'task_request',
  TASK_RESPONSE = 'task_response',
  AGENT_STATUS = 'agent_status',
  COORDINATION = 'coordination',
  QUERY = 'query',
  BROADCAST = 'broadcast',
  ERROR = 'error'
}

export interface AgentCapability {
  name: string;
  description: string;
  requiredServices: string[];
  estimatedDuration?: number; // milliseconds
  successRate?: number; // 0-1
}

export interface AgentMetadata {
  id: string;
  name: string;
  type: AgentType;
  version: string;
  capabilities: AgentCapability[];
  status: AgentStatus;
  createdAt: Date;
  lastHeartbeat: Date;
  tasksCompleted: number;
  tasksAssigned: number;
  tasksFailed: number;
  averageResponseTime: number;
}

export interface AgentTask {
  id: string;
  type: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  payload: any;
  requiredCapabilities?: string[];
  assignedTo?: string; // agent id
  createdBy?: string; // agent id or user id
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  deadline?: Date;
  result?: TaskResult;
  retries?: number;
  maxRetries?: number;
  dependencies?: string[]; // task ids that must complete first
}

export interface TaskResult {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: {
    executionTime: number;
    resourcesUsed?: any;
    intermediateSteps?: any[];
  };
}

export interface AgentMessage {
  id: string;
  type: MessageType;
  from: string; // agent id
  to: string | string[]; // agent id(s) or 'broadcast'
  payload: any;
  timestamp: Date;
  correlationId?: string; // for tracking conversations
  replyTo?: string; // message id
  ttl?: number; // time to live in seconds
}

export interface AgentContext {
  env: any; // Environment bindings
  services: {
    [key: string]: any;
  };
  messageBus: any;
  storage: any; // KV or Durable Object storage
}

export interface CoordinationRequest {
  requestingAgent: string;
  requiredCapabilities: string[];
  task: AgentTask;
  timeout?: number;
}

export interface CoordinationResponse {
  agentId: string;
  accepted: boolean;
  estimatedDuration?: number;
  reason?: string;
}
