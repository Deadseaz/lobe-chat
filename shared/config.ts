/**
 * Shared Configuration Service
 * Centralizes configuration management for the agent system
 */

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
}

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
}

export interface AIGatewayConfig {
  url: string;
  authToken?: string;
  timeout?: number;
}

export interface SecurityConfig {
  promptInjectionProtection: boolean;
  aiAccessPolicy: 'strict' | 'moderate' | 'permissive';
  enableZeroTrust: boolean;
  enableAIGuardrails: boolean;
  maxInputLength: number;
  rateLimitRequests: number;
  rateLimitWindow: number;
}

export interface AgentConfig {
  maxConcurrentTasks: number;
  taskTimeout: number;
  retryAttempts: number;
  enableInfrastructureAgent: boolean;
  enableMonitoringAgent: boolean;
  enableKnowledgeAgent: boolean;
  enableSecurityAgent: boolean;
}

export interface SystemConfig {
  database: DatabaseConfig;
  redis: RedisConfig;
  aiGateway: AIGatewayConfig;
  security: SecurityConfig;
  agent: AgentConfig;
  cloudflare: {
    apiToken?: string;
    accountId?: string;
    gatewayUrl?: string;
  };
  monitoring: {
    prometheusUrl: string;
    grafanaUrl: string;
  };
  vectors: {
    qdrantUrl: string;
    embeddingModel: string;
  };
  // Shortcut properties for Cloudflare Worker compatibility
  cfAccountId?: string;
  cfApiToken?: string;
  cfGatewayUrl?: string;
  cfGatewayAuthToken?: string;
  // Security shortcuts
  securitySessionSecret?: string;
  securityJwtSecret?: string;
  // Feature flags
  selfHealingEnabled?: boolean;
  // Raw environment access
  originalEnv?: Record<string, string | undefined>;
}

/**
 * Configuration Service - Manages all system configuration
 */
export class ConfigService {
  private config: SystemConfig;

  constructor() {
    this.config = this.loadFromEnvironment();
  }

  /**
   * Load configuration from environment variables
   */
  private loadFromEnvironment(): SystemConfig {
    return {
      database: this.parseDatabaseUrl(process.env.DATABASE_URL || ''),
      redis: this.parseRedisUrl(process.env.REDIS_URL || ''),
      aiGateway: {
        url: process.env.AI_GATEWAY_URL || process.env.CF_GATEWAY_URL || 'http://nginx:8080',
        authToken: process.env.AI_GATEWAY_TOKEN || process.env.CF_AIG_BEARER,
        timeout: parseInt(process.env.AI_GATEWAY_TIMEOUT || '120000')
      },
      security: {
        promptInjectionProtection: process.env.PROMPT_INJECTION_PROTECTION !== 'false',
        aiAccessPolicy: (process.env.AI_ACCESS_POLICY as any) || 'strict',
        enableZeroTrust: process.env.ENABLE_ZERO_TRUST === 'true',
        enableAIGuardrails: process.env.ENABLE_AI_GUARDRAILS !== 'false',
        maxInputLength: parseInt(process.env.MAX_INPUT_LENGTH || '10000'),
        rateLimitRequests: parseInt(process.env.RATE_LIMIT_REQUESTS || '100'),
        rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW || '60')
      },
      agent: {
        maxConcurrentTasks: parseInt(process.env.MAX_CONCURRENT_TASKS || '50'),
        taskTimeout: parseInt(process.env.TASK_TIMEOUT || '300000'),
        retryAttempts: parseInt(process.env.RETRY_ATTEMPTS || '3'),
        enableInfrastructureAgent: process.env.ENABLE_INFRASTRUCTURE_AGENT !== 'false',
        enableMonitoringAgent: process.env.ENABLE_MONITORING_AGENT !== 'false',
        enableKnowledgeAgent: process.env.ENABLE_KNOWLEDGE_AGENT !== 'false',
        enableSecurityAgent: process.env.ENABLE_SECURITY_AGENT !== 'false'
      },
      cloudflare: {
        apiToken: process.env.CLOUDFLARE_API_TOKEN,
        accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
        gatewayUrl: process.env.CF_GATEWAY_URL
      },
      monitoring: {
        prometheusUrl: process.env.PROMETHEUS_URL || 'http://prometheus:9090',
        grafanaUrl: process.env.GRAFANA_URL || 'http://grafana:3000'
      },
      vectors: {
        qdrantUrl: process.env.QDRANT_URL || 'http://qdrant:6333',
        embeddingModel: process.env.EMBEDDING_MODEL || 'nomic-embed-text'
      },
      // Shortcut properties for Cloudflare Worker compatibility
      cfAccountId: process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID,
      cfApiToken: process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN,
      cfGatewayUrl: process.env.CF_GATEWAY_URL,
      cfGatewayAuthToken: process.env.CF_AIG_BEARER,
      securitySessionSecret: process.env.SESSION_SECRET,
      securityJwtSecret: process.env.JWT_SECRET,
      selfHealingEnabled: process.env.SELF_HEALING_ENABLED === 'true',
      originalEnv: process.env as Record<string, string | undefined>
    };
  }

  /**
   * Parse DATABASE_URL into components
   */
  private parseDatabaseUrl(url: string): DatabaseConfig {
    if (!url) {
      return {
        host: process.env.POSTGRES_HOST || 'postgres',
        port: parseInt(process.env.POSTGRES_PORT || '5432'),
        database: process.env.POSTGRES_DB || 'zagent_kb',
        user: process.env.POSTGRES_USER || 'zagent',
        password: process.env.POSTGRES_PASSWORD || ''
      };
    }

    try {
      const parsed = new URL(url);
      return {
        host: parsed.hostname,
        port: parseInt(parsed.port) || 5432,
        database: parsed.pathname.slice(1),
        user: parsed.username,
        password: parsed.password,
        ssl: parsed.searchParams.get('sslmode') === 'require'
      };
    } catch {
      return {
        host: 'postgres',
        port: 5432,
        database: 'zagent_kb',
        user: 'zagent',
        password: ''
      };
    }
  }

  /**
   * Parse REDIS_URL into components
   */
  private parseRedisUrl(url: string): RedisConfig {
    if (!url) {
      return {
        host: process.env.REDIS_HOST || 'redis',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
        db: parseInt(process.env.REDIS_DB || '0')
      };
    }

    try {
      const parsed = new URL(url);
      return {
        host: parsed.hostname,
        port: parseInt(parsed.port) || 6379,
        password: parsed.password || undefined,
        db: parseInt(parsed.pathname.slice(1)) || 0
      };
    } catch {
      return {
        host: 'redis',
        port: 6379,
        db: 0
      };
    }
  }

  /**
   * Get full configuration
   */
  getConfig(): SystemConfig {
    return this.config;
  }

  /**
   * Get database configuration
   */
  getDatabase(): DatabaseConfig {
    return this.config.database;
  }

  /**
   * Get Redis configuration
   */
  getRedis(): RedisConfig {
    return this.config.redis;
  }

  /**
   * Get security configuration
   */
  getSecurity(): SecurityConfig {
    return this.config.security;
  }

  /**
   * Get agent configuration
   */
  getAgent(): AgentConfig {
    return this.config.agent;
  }

  /**
   * Get AI Gateway configuration
   */
  getAIGateway(): AIGatewayConfig {
    return this.config.aiGateway;
  }

  /**
   * Get Cloudflare configuration
   */
  getCloudflare() {
    return this.config.cloudflare;
  }

  /**
   * Get monitoring configuration
   */
  getMonitoring() {
    return this.config.monitoring;
  }

  /**
   * Get vector configuration
   */
  getVectors() {
    return this.config.vectors;
  }

  /**
   * Check if a feature is enabled
   */
  isFeatureEnabled(feature: string): boolean {
    switch (feature) {
      case 'promptInjectionProtection':
        return this.config.security.promptInjectionProtection;
      case 'zeroTrust':
        return this.config.security.enableZeroTrust;
      case 'aiGuardrails':
        return this.config.security.enableAIGuardrails;
      case 'infrastructureAgent':
        return this.config.agent.enableInfrastructureAgent;
      case 'monitoringAgent':
        return this.config.agent.enableMonitoringAgent;
      case 'knowledgeAgent':
        return this.config.agent.enableKnowledgeAgent;
      case 'securityAgent':
        return this.config.agent.enableSecurityAgent;
      default:
        return false;
    }
  }

  /**
   * Get connection string for PostgreSQL
   */
  getDatabaseUrl(): string {
    const db = this.config.database;
    return `postgres://${db.user}:${db.password}@${db.host}:${db.port}/${db.database}`;
  }

  /**
   * Get connection string for Redis
   */
  getRedisUrl(): string {
    const r = this.config.redis;
    const auth = r.password ? `:${r.password}@` : '';
    return `redis://${auth}${r.host}:${r.port}/${r.db || 0}`;
  }
}

// Export singleton instance
export const config = new ConfigService();
