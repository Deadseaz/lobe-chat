/**
 * Core Types for Cloudflare Workers and Agent System
 */

// Cloudflare Environment bindings
export interface CloudflareEnv {
  // AI Gateway
  AI: Ai;
  
  // KV Namespaces
  AGENT_KV?: KVNamespace;
  CONFIG_KV?: KVNamespace;
  CACHE_KV?: KVNamespace;
  
  // Durable Objects
  AGENT_MESSAGE_BUS?: DurableObjectNamespace;
  
  // D1 Databases
  DB?: D1Database;
  
  // R2 Buckets
  STORAGE?: R2Bucket;
  
  // Environment variables
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CF_GATEWAY_URL?: string;
  CF_AIG_BEARER?: string;
  JWT_SECRET?: string;
  SESSION_SECRET?: string;
  
  // Any additional bindings
  [key: string]: any;
}

// Error types for the system
export enum ErrorType {
  VALIDATION = 'VALIDATION',
  AUTHENTICATION = 'AUTHENTICATION',
  AUTHORIZATION = 'AUTHORIZATION',
  NOT_FOUND = 'NOT_FOUND',
  RATE_LIMIT = 'RATE_LIMIT',
  INTERNAL = 'INTERNAL',
  EXTERNAL = 'EXTERNAL',
  EXTERNAL_SERVICE = 'EXTERNAL_SERVICE',
  TIMEOUT = 'TIMEOUT',
  CONFIGURATION = 'CONFIGURATION',
  AI_GATEWAY = 'AI_GATEWAY',
  DATABASE = 'DATABASE',
  NETWORK = 'NETWORK'
}

// Custom error class
export class ZAgentError extends Error {
  public readonly type: ErrorType;
  public readonly statusCode: number;
  public readonly details?: any;
  public readonly timestamp: Date;

  constructor(
    message: string,
    type: ErrorType = ErrorType.INTERNAL,
    statusCode: number = 500,
    details?: any
  ) {
    super(message);
    this.name = 'ZAgentError';
    this.type = type;
    this.statusCode = statusCode;
    this.details = details;
    this.timestamp = new Date();
    
    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ZAgentError);
    }
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      type: this.type,
      statusCode: this.statusCode,
      details: this.details,
      timestamp: this.timestamp.toISOString(),
      stack: this.stack
    };
  }

  static fromError(error: Error, type: ErrorType = ErrorType.INTERNAL): ZAgentError {
    if (error instanceof ZAgentError) {
      return error;
    }
    return new ZAgentError(error.message, type, 500, { originalError: error.name });
  }

  static validation(message: string, details?: any): ZAgentError {
    return new ZAgentError(message, ErrorType.VALIDATION, 400, details);
  }

  static authentication(message: string = 'Authentication required'): ZAgentError {
    return new ZAgentError(message, ErrorType.AUTHENTICATION, 401);
  }

  static authorization(message: string = 'Access denied'): ZAgentError {
    return new ZAgentError(message, ErrorType.AUTHORIZATION, 403);
  }

  static notFound(resource: string): ZAgentError {
    return new ZAgentError(`${resource} not found`, ErrorType.NOT_FOUND, 404);
  }

  static rateLimit(message: string = 'Rate limit exceeded'): ZAgentError {
    return new ZAgentError(message, ErrorType.RATE_LIMIT, 429);
  }

  static timeout(operation: string): ZAgentError {
    return new ZAgentError(`Operation timed out: ${operation}`, ErrorType.TIMEOUT, 408);
  }
}

// AI Model types
export interface AIModelConfig {
  name: string;
  provider: 'openai' | 'anthropic' | 'cloudflare' | 'ollama' | 'custom';
  maxTokens: number;
  contextWindow: number;
  capabilities: string[];
}

// Request/Response types
export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    type: ErrorType;
    message: string;
    details?: any;
  };
  meta?: {
    requestId: string;
    duration: number;
    timestamp: string;
  };
}
