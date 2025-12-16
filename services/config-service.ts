/**
 * Advanced Configuration Service for ZAgent
 * Implements centralized configuration management with validation, reloading, and environment-specific settings
 */

import { Context } from 'hono';

// Configuration types
export interface DatabaseConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  ssl: boolean;
}

export interface RedisConfig {
  url: string;
  host: string;
  port: number;
  password?: string | undefined;
  db: number;
  tls?: {
    ca?: string;
    cert?: string;
    key?: string;
  };
}

export interface JwtConfig {
  secret: string;
  expiresIn: string;
  refreshSecret: string;
  refreshExpiresIn: string;
}

export interface SecurityConfig {
  jwt: JwtConfig;
  cors: {
    origin: string | string[];
    credentials: boolean;
  };
  rateLimit: {
    windowMs: number;
    max: number;
    message: string;
  };
 helmet: {
    contentSecurityPolicy: boolean;
    dnsPrefetchControl: boolean;
    frameguard: boolean;
    hidePoweredBy: boolean;
    hsts: boolean;
    ieNoOpen: boolean;
    noSniff: boolean;
    referrerPolicy: boolean;
  };
}

export interface MonitoringConfig {
  enabled: boolean;
  endpoint: string;
  apiKey: string;
  serviceName: string;
  environment: string;
}

export interface FeatureFlags {
  [key: string]: boolean;
}

export interface AppConfig {
  env: string;
  port: number;
  host: string;
  database: DatabaseConfig;
  redis: RedisConfig;
  security: SecurityConfig;
  monitoring: MonitoringConfig;
  featureFlags: FeatureFlags;
  logging: {
    level: string;
    format: string;
    enabled: boolean;
  };
}

// Configuration service class
export class ConfigService {
  private config: AppConfig;
  private defaults: AppConfig;
  private validators: Map<string, (value: any) => boolean>;

  constructor(initialConfig?: Partial<AppConfig>) {
    this.defaults = {
      env: process.env['NODE_ENV'] || 'development',
      port: parseInt(process.env['PORT'] || '3000'),
      host: process.env['HOST'] || '0.0.0.0',
      database: {
        host: process.env['DB_HOST'] || 'localhost',
        port: parseInt(process.env['DB_PORT'] || '5432'),
        username: process.env['DB_USERNAME'] || 'postgres',
        password: process.env['DB_PASSWORD'] || 'password',
        database: process.env['DB_NAME'] || 'zagent',
        ssl: process.env['DB_SSL'] === 'true'
      },
      redis: {
        url: process.env['REDIS_URL'] || 'redis://localhost:6379',
        host: process.env['REDIS_HOST'] || 'localhost',
        port: parseInt(process.env['REDIS_PORT'] || '6379'),
        password: process.env['REDIS_PASSWORD'],
        db: parseInt(process.env['REDIS_DB'] || '0')
      },
      security: {
        jwt: {
          secret: process.env['JWT_SECRET'] || 'default-jwt-secret',
          expiresIn: process.env['JWT_EXPIRES_IN'] || '15m',
          refreshSecret: process.env['JWT_REFRESH_SECRET'] || 'default-refresh-secret',
          refreshExpiresIn: process.env['JWT_REFRESH_EXPIRES_IN'] || '7d'
        },
        cors: {
          origin: process.env['CORS_ORIGIN']?.split(',') || ['*'],
          credentials: process.env['CORS_CREDENTIALS'] === 'true'
        },
        rateLimit: {
          windowMs: parseInt(process.env['RATE_LIMIT_WINDOW_MS'] || '90000'), // 15 minutes
          max: parseInt(process.env['RATE_LIMIT_MAX'] || '100'),
          message: process.env['RATE_LIMIT_MESSAGE'] || 'Too many requests, please try again later.'
        },
        helmet: {
          contentSecurityPolicy: process.env['HELMET_CSP'] !== 'false',
          dnsPrefetchControl: process.env['HELMET_DNS_PREFETCH'] !== 'false',
          frameguard: process.env['HELMET_FRAMEGUARD'] !== 'false',
          hidePoweredBy: process.env['HELMET_HIDE_POWERED_BY'] !== 'false',
          hsts: process.env['HELMET_HSTS'] !== 'false',
          ieNoOpen: process.env['HELMET_IE_NO_OPEN'] !== 'false',
          noSniff: process.env['HELMET_NO_SNIFF'] !== 'false',
          referrerPolicy: process.env['HELMET_REFERRER_POLICY'] !== 'false'
        }
      },
      monitoring: {
        enabled: process.env['MONITORING_ENABLED'] === 'true',
        endpoint: process.env['MONITORING_ENDPOINT'] || 'http://localhost:9090',
        apiKey: process.env['MONITORING_API_KEY'] || '',
        serviceName: process.env['SERVICE_NAME'] || 'zagent',
        environment: process.env['NODE_ENV'] || 'development'
      },
      featureFlags: {
        'ai-gateway-enabled': process.env['FF_AI_GATEWAY_ENABLED'] !== 'false',
        'real-time-enabled': process.env['FF_REAL_TIME_ENABLED'] !== 'false',
        'advanced-security-enabled': process.env['FF_ADVANCED_SECURITY_ENABLED'] === 'true',
        'user-management-enabled': process.env['FF_USER_MANAGEMENT_ENABLED'] !== 'false',
        'logging-enhanced': process.env['FF_LOGGING_ENHANCED'] === 'true'
      },
      logging: {
        level: process.env['LOG_LEVEL'] || 'info',
        format: process.env['LOG_FORMAT'] || 'json',
        enabled: process.env['LOGGING_ENABLED'] !== 'false'
      }
    };

    // Merge initial config with defaults
    this.config = { ...this.defaults, ...initialConfig };
    
    // Set up validators
    this.validators = new Map();
    this.setupValidators();
  }

 /**
   * Get configuration value by path
   */
  get<T = any>(path: string): T {
    return this.getNestedValue(this.config, path) as T;
  }

 /**
   * Set configuration value by path
   */
  set(path: string, value: any): void {
    this.setNestedValue(this.config, path, value);
  }

  /**
   * Get the full configuration
   */
  getAll(): AppConfig {
    return { ...this.config };
  }

  /**
   * Update configuration with new values
   */
  update(newConfig: Partial<AppConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Validate configuration
   */
  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const [key, validator] of this.validators) {
      const value = this.get(key);
      if (!validator(value)) {
        errors.push(`Validation failed for ${key}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Reload configuration from environment variables
   */
  reload(): void {
    // Reload environment-specific config
    this.config.env = process.env['NODE_ENV'] || this.config.env;
    this.config.port = parseInt(process.env['PORT'] || this.config.port.toString());
    this.config.host = process.env['HOST'] || this.config.host;

    // Reload database config
    this.config.database = {
      ...this.config.database,
      host: process.env['DB_HOST'] || this.config.database.host,
      port: parseInt(process.env['DB_PORT'] || this.config.database.port.toString()),
      username: process.env['DB_USERNAME'] || this.config.database.username,
      password: process.env['DB_PASSWORD'] || this.config.database.password,
      database: process.env['DB_NAME'] || this.config.database.database,
      ssl: process.env['DB_SSL'] === 'true'
    };

    // Reload Redis config
    this.config.redis = {
      ...this.config.redis,
      url: process.env['REDIS_URL'] || this.config.redis.url,
      host: process.env['REDIS_HOST'] || this.config.redis.host,
      port: parseInt(process.env['REDIS_PORT'] || this.config.redis.port.toString()),
      password: process.env['REDIS_PASSWORD'] || this.config.redis.password,
      db: parseInt(process.env['REDIS_DB'] || this.config.redis.db.toString())
    };

    // Reload security config
    this.config.security = {
      ...this.config.security,
      jwt: {
        ...this.config.security.jwt,
        secret: process.env['JWT_SECRET'] || this.config.security.jwt.secret,
        expiresIn: process.env['JWT_EXPIRES_IN'] || this.config.security.jwt.expiresIn,
        refreshSecret: process.env['JWT_REFRESH_SECRET'] || this.config.security.jwt.refreshSecret,
        refreshExpiresIn: process.env['JWT_REFRESH_EXPIRES_IN'] || this.config.security.jwt.refreshExpiresIn
      },
      cors: {
        ...this.config.security.cors,
        origin: process.env['CORS_ORIGIN']?.split(',') || this.config.security.cors.origin,
        credentials: process.env['CORS_CREDENTIALS'] === 'true'
      },
      rateLimit: {
        ...this.config.security.rateLimit,
        windowMs: parseInt(process.env['RATE_LIMIT_WINDOW_MS'] || this.config.security.rateLimit.windowMs.toString()),
        max: parseInt(process.env['RATE_LIMIT_MAX'] || this.config.security.rateLimit.max.toString()),
        message: process.env['RATE_LIMIT_MESSAGE'] || this.config.security.rateLimit.message
      }
    };
  }

  /**
   * Check if a feature flag is enabled
   */
  isFeatureEnabled(feature: string): boolean {
    return this.config.featureFlags[feature] || false;
  }

 /**
   * Enable a feature flag
   */
  enableFeature(feature: string): void {
    this.config.featureFlags[feature] = true;
  }

  /**
   * Disable a feature flag
   */
  disableFeature(feature: string): void {
    this.config.featureFlags[feature] = false;
  }

  /**
   * Get environment-specific configuration
   */
  getEnvironment(): string {
    return this.config.env;
  }

  /**
   * Check if running in development environment
   */
  isDevelopment(): boolean {
    return this.config.env === 'development';
  }

  /**
   * Check if running in production environment
   */
  isProduction(): boolean {
    return this.config.env === 'production';
  }

  /**
   * Check if running in staging environment
   */
  isStaging(): boolean {
    return this.config.env === 'staging';
  }

  /**
   * Set up validators for configuration values
   */
  private setupValidators(): void {
    // Port validation
    this.validators.set('port', (value: any) => {
      return typeof value === 'number' && value > 0 && value < 65536;
    });

    // Database port validation
    this.validators.set('database.port', (value: any) => {
      return typeof value === 'number' && value > 0 && value < 65536;
    });

    // Redis port validation
    this.validators.set('redis.port', (value: any) => {
      return typeof value === 'number' && value > 0 && value < 65536;
    });

    // JWT expiration validation
    this.validators.set('security.jwt.expiresIn', (value: any) => {
      return typeof value === 'string' && this.isValidTimeFormat(value);
    });

    // Refresh token expiration validation
    this.validators.set('security.jwt.refreshExpiresIn', (value: any) => {
      return typeof value === 'string' && this.isValidTimeFormat(value);
    });
  }

 /**
   * Check if time format is valid (e.g., '15m', '1h', '7d')
   */
  private isValidTimeFormat(timeStr: string): boolean {
    const regex = /^(\d+)(s|m|h|d)$/;
    return regex.test(timeStr);
  }

 /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

 /**
   * Set nested value in object using dot notation
   */
  private setNestedValue(obj: any, path: string, value: any): void {
    const keys = path.split('.');
    const lastKey = keys.pop()!;
    const lastObj = keys.reduce((current, key) => {
      if (current[key] === undefined) current[key] = {};
      return current[key];
    }, obj);
    lastObj[lastKey] = value;
  }
}

// Initialize config service middleware
export const initializeConfig = async (c: Context, next: () => Promise<void>) => {
  const configService = new ConfigService();
  c.set('configService', configService);
  await next();
};

// Get config service from context
export const getConfigService = (c: Context): ConfigService => {
  return c.get('configService') as ConfigService;
};

// Configuration validation middleware
export const validateConfig = async (c: Context, next: () => Promise<void>) => {
  const configService = c.get('configService') as ConfigService;
  if (!configService) {
    return c.json({ error: 'Config service not initialized' }, 500);
  }

  const { valid, errors } = configService.validate();
  if (!valid) {
    return c.json({ error: 'Configuration validation failed', details: errors }, 500);
  }

 await next();
};

// Feature flag middleware
export const requireFeature = (feature: string) => {
  return async (c: Context, next: () => Promise<void>) => {
    const configService = c.get('configService') as ConfigService;
    if (!configService) {
      return c.json({ error: 'Config service not initialized' }, 500);
    }

    if (!configService.isFeatureEnabled(feature)) {
      return c.json({ error: `Feature ${feature} is not enabled` }, 403);
    }

    await next();
  };
};