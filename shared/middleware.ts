/**
 * Shared Middleware - AI Guardrails and Security
 * Provides prompt injection protection and input validation
 */

import { Request, Response, NextFunction } from 'express';

export interface GuardrailResult {
  allowed: boolean;
  reason?: string;
  sanitizedInput?: string;
  confidence: number;
  threats?: string[];
}

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

/**
 * AI Guardrails Service - Protects against prompt injection and malicious inputs
 */
export class AIGuardrailsService {
  private enabled: boolean;
  private strictMode: boolean;
  private maxInputLength: number;
  private rateLimitStore: Map<string, { count: number; resetTime: number }> = new Map();
  
  // Known prompt injection patterns
  private readonly injectionPatterns: RegExp[] = [
    /ignore\s+(the\s+)?(above|previous|all)\s+(instructions?|prompts?|rules?)/gi,
    /disregard\s+(the\s+)?(above|previous|all)\s+(instructions?|prompts?|rules?)/gi,
    /forget\s+(the\s+)?(above|previous|all|everything)/gi,
    /you\s+are\s+now\s+(a|an|the)/gi,
    /new\s+instruction[s]?:/gi,
    /system\s*:\s*you\s+are/gi,
    /\[system\]/gi,
    /\[assistant\]/gi,
    /\[user\]/gi,
    /###\s*(instruction|system|assistant|user)/gi,
    /```system/gi,
    /<\|im_start\|>/gi,
    /<\|im_end\|>/gi,
    /act\s+as\s+(if\s+)?(you\s+)?(are|were)/gi,
    /pretend\s+(to\s+be|you\s+are)/gi,
    /role\s*play\s+as/gi,
    /jailbreak/gi,
    /dan\s*mode/gi,
    /developer\s*mode/gi,
    /ignore\s+safety/gi,
    /bypass\s+(the\s+)?(filter|safety|restriction)/gi,
    /override\s+(the\s+)?(system|safety|instruction)/gi,
  ];

  // Dangerous command patterns
  private readonly commandPatterns: RegExp[] = [
    /\$\([^)]+\)/g,           // $(command)
    /`[^`]+`/g,               // `command`
    /\|\s*\w+/g,              // | pipe
    /;\s*\w+/g,               // ; command chain
    /&&\s*\w+/g,              // && command chain
    /\|\|\s*\w+/g,            // || command chain
    /<script[^>]*>/gi,        // XSS script tags
    /javascript:/gi,          // javascript: URLs
    /on\w+\s*=/gi,            // onclick= etc
  ];

  constructor(config?: { enabled?: boolean; strictMode?: boolean; maxInputLength?: number }) {
    this.enabled = config?.enabled ?? (process.env.ENABLE_AI_GUARDRAILS !== 'false');
    this.strictMode = config?.strictMode ?? (process.env.AI_ACCESS_POLICY === 'strict');
    this.maxInputLength = config?.maxInputLength ?? parseInt(process.env.MAX_INPUT_LENGTH || '10000');
  }

  /**
   * Validate input for prompt injection and other threats
   */
  async validateInput(input: string, context?: any): Promise<GuardrailResult> {
    if (!this.enabled) {
      return { allowed: true, confidence: 1.0 };
    }

    const threats: string[] = [];
    let riskScore = 0;

    // Check input length
    if (input.length > this.maxInputLength) {
      threats.push('Input exceeds maximum length');
      riskScore += 3;
    }

    // Check for prompt injection patterns
    for (const pattern of this.injectionPatterns) {
      if (pattern.test(input)) {
        threats.push(`Prompt injection pattern detected: ${pattern.source.substring(0, 30)}...`);
        riskScore += 5;
        pattern.lastIndex = 0; // Reset regex state
      }
    }

    // Check for command injection patterns
    for (const pattern of this.commandPatterns) {
      if (pattern.test(input)) {
        threats.push(`Command injection pattern detected`);
        riskScore += 4;
        pattern.lastIndex = 0;
      }
    }

    // Check for suspicious character sequences
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(input)) {
      threats.push('Suspicious control characters detected');
      riskScore += 2;
    }

    // Check for excessive special characters
    const specialCharRatio = (input.match(/[{}[\]<>|\\^~`]/g) || []).length / input.length;
    if (specialCharRatio > 0.1) {
      threats.push('Excessive special characters');
      riskScore += 1;
    }

    // Determine if allowed based on risk score
    const threshold = this.strictMode ? 3 : 5;
    const allowed = riskScore < threshold;
    const confidence = Math.max(0, Math.min(1, 1 - (riskScore / 10)));

    // Sanitize if needed
    let sanitizedInput: string | undefined;
    if (!allowed && !this.strictMode) {
      sanitizedInput = this.sanitizeInput(input);
    }

    return {
      allowed,
      confidence,
      threats: threats.length > 0 ? threats : undefined,
      reason: threats.length > 0 ? threats.join('; ') : undefined,
      sanitizedInput
    };
  }

  /**
   * Sanitize input by removing dangerous patterns
   */
  sanitizeInput(input: string): string {
    let sanitized = input;

    // Remove command injection patterns
    for (const pattern of this.commandPatterns) {
      sanitized = sanitized.replace(pattern, '[REMOVED]');
    }

    // Remove control characters
    sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

    // Escape HTML-like tags
    sanitized = sanitized.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    return sanitized.trim();
  }

  /**
   * Check rate limit for a client
   */
  checkRateLimit(clientId: string, config?: RateLimitConfig): boolean {
    const windowMs = config?.windowMs ?? 60000; // 1 minute default
    const maxRequests = config?.maxRequests ?? parseInt(process.env.RATE_LIMIT_REQUESTS || '100');
    
    const now = Date.now();
    const clientData = this.rateLimitStore.get(clientId);

    if (!clientData || now > clientData.resetTime) {
      this.rateLimitStore.set(clientId, { count: 1, resetTime: now + windowMs });
      return true;
    }

    if (clientData.count >= maxRequests) {
      return false;
    }

    clientData.count++;
    return true;
  }

  /**
   * Express middleware for input validation
   */
  middleware() {
    return async (req: Request, res: Response, next: NextFunction) => {
      // Check rate limit
      const clientId = req.ip || req.headers['x-forwarded-for'] as string || 'unknown';
      if (!this.checkRateLimit(clientId)) {
        return res.status(429).json({ error: 'Too many requests', retryAfter: 60 });
      }

      // Validate request body if present
      if (req.body) {
        const contentToValidate = JSON.stringify(req.body);
        const result = await this.validateInput(contentToValidate);

        if (!result.allowed) {
          return res.status(400).json({
            error: 'Input validation failed',
            reason: result.reason,
            threats: result.threats
          });
        }

        // Attach validation result to request
        (req as any).guardrailResult = result;
      }

      next();
    };
  }

  /**
   * Get current configuration
   */
  getConfig() {
    return {
      enabled: this.enabled,
      strictMode: this.strictMode,
      maxInputLength: this.maxInputLength,
      patternCount: this.injectionPatterns.length + this.commandPatterns.length
    };
  }
}

/**
 * Authentication middleware
 */
export class AuthMiddleware {
  private apiKeys: Map<string, { userId: string; roles: string[] }> = new Map();

  constructor() {
    // Initialize with environment-based API key if provided
    const masterKey = process.env.AGENT_API_KEY;
    if (masterKey) {
      this.apiKeys.set(masterKey, { userId: 'master', roles: ['admin', 'agent', 'user'] });
    }
    
    // Default development key (should be disabled in production)
    if (process.env.NODE_ENV !== 'production') {
      this.apiKeys.set('dev-key', { userId: 'dev', roles: ['admin', 'agent', 'user'] });
    }
  }

  /**
   * Add an API key
   */
  addApiKey(key: string, userId: string, roles: string[]): void {
    this.apiKeys.set(key, { userId, roles });
  }

  /**
   * Validate API key middleware
   */
  requireAuth(requiredRoles?: string[]) {
    return (req: Request, res: Response, next: NextFunction) => {
      const apiKey = req.headers['x-api-key'] as string || req.query.apiKey as string;

      if (!apiKey) {
        return res.status(401).json({ error: 'API key required' });
      }

      const keyData = this.apiKeys.get(apiKey);
      if (!keyData) {
        return res.status(401).json({ error: 'Invalid API key' });
      }

      // Check roles if required
      if (requiredRoles && requiredRoles.length > 0) {
        const hasRole = requiredRoles.some(role => keyData.roles.includes(role));
        if (!hasRole) {
          return res.status(403).json({ error: 'Insufficient permissions' });
        }
      }

      // Attach user info to request
      (req as any).user = keyData;
      next();
    };
  }

  /**
   * Optional auth - allows unauthenticated requests but attaches user if present
   */
  optionalAuth() {
    return (req: Request, res: Response, next: NextFunction) => {
      const apiKey = req.headers['x-api-key'] as string || req.query.apiKey as string;

      if (apiKey) {
        const keyData = this.apiKeys.get(apiKey);
        if (keyData) {
          (req as any).user = keyData;
        }
      }

      next();
    };
  }
}

// Export singleton instances
export const guardrails = new AIGuardrailsService();
export const auth = new AuthMiddleware();
