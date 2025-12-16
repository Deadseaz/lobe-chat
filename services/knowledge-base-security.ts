/**
 * Enhanced Knowledge Base Security Implementation
 * Implements comprehensive security measures for the knowledge base system
 */

import { Context } from 'hono';
import { AIGuardrailsService } from '../shared/middleware.js';

interface GuardResult {
 allowed: boolean;
  reason?: string;
  sanitizedInput?: string;
  confidence: number;
}

export interface SecurityConfig {
  maxInputLength: number;
  blockedKeywords: string[];
  similarityThreshold: number;
  contextBoundaryEnforcement: boolean;
  rateLimit: number;
}

export class KnowledgeBaseSecurityService {
  private config: SecurityConfig;
  private aiGuardrails: AIGuardrailsService;

  constructor(config: SecurityConfig, aiGuardrails: AIGuardrailsService) {
    this.config = config;
    this.aiGuardrails = aiGuardrails;
  }

  /**
   * Validates input before storing in knowledge base
   */
 async validateInput(input: string, context?: any): Promise<GuardResult> {
    // Check length
    if (input.length > this.config.maxInputLength) {
      return {
        allowed: false,
        reason: `Input exceeds maximum length of ${this.config.maxInputLength} characters`,
        confidence: 0.9
      };
    }

    // Check for blocked keywords
    const blockedMatch = this.config.blockedKeywords.find(keyword => 
      input.toLowerCase().includes(keyword.toLowerCase())
    );
    
    if (blockedMatch) {
      return {
        allowed: false,
        reason: `Blocked keyword detected: ${blockedMatch}`,
        confidence: 0.95
      };
    }

    // Check for prompt injection attempts
    const injectionScore = this.checkPromptInjection(input);
    if (injectionScore > 0.7) {
      return {
        allowed: false,
        reason: 'Potential prompt injection detected',
        confidence: injectionScore
      };
    }

    // Sanitize the input
    const sanitized = this.sanitizeInput(input);
    
    // Check if sanitized differs significantly from original (potential attack)
    const similarity = this.calculateSimilarity(input, sanitized);
    if (similarity < 0.8) {
      return {
        allowed: false,
        reason: 'Input contains potentially harmful content that was sanitized',
        confidence: 0.85
      };
    }

    return {
      allowed: true,
      sanitizedInput: sanitized,
      confidence: 0.9
    };
  }

  /**
   * Checks for prompt injection patterns
   */
  private checkPromptInjection(input: string): number {
    const patterns = [
      /ignore\s+(the\s+)?(above|previous|instructions)/i,
      /disregard\s+(the\s+)?(above|previous|instructions)/i,
      /but\s+actually/i,
      /never\s+mind/i,
      /system\s+prompt/i,
      /instruction.*override/i,
      /###\s*(Instruction|System|Assistant|User)/i,
      /<\|.*?\|>/g,  // Potential template markers
    ];

    let maxScore = 0;
    for (const pattern of patterns) {
      if (pattern.test(input)) {
        const matchCount = (input.match(pattern) || []).length;
        maxScore = Math.max(maxScore, Math.min(0.9, 0.1 + (matchCount * 0.3)));
      }
    }

    return maxScore;
  }

  /**
   * Sanitizes input to remove harmful content
   */
  private sanitizeInput(input: string): string {
    // Remove script tags and potential XSS
    let sanitized = input.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    
    // Remove other potentially harmful HTML
    sanitized = sanitized.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
    sanitized = sanitized.replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '');
    sanitized = sanitized.replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, '');
    
    // Remove potential command injection patterns
    sanitized = sanitized.replace(/(\||;|&&|\$\(.*?\)|`.*?`)/g, ' ');
    
    // Remove potential path traversal
    sanitized = sanitized.replace(/\.\.\//g, '');
    sanitized = sanitized.replace(/%2e%2e%2f/g, '');
    
    // Remove potential SQL injection patterns
    sanitized = sanitized.replace(/(drop|delete|insert|update|select|create|alter|exec|execute|union|all|or|and)\s+/gi, ' ');
    
    // Clean up any double spaces
    sanitized = sanitized.trim().replace(/\s+/g, ' ');

    return sanitized;
  }

  /**
   * Calculate similarity between two strings (0.0 to 1.0)
   */
  private calculateSimilarity(str1: string, str2: string): number {
    if (str1 === str2) return 1.0;
    if (str1.length === 0 && str2.length === 0) return 1.0;
    if (str1.length === 0 || str2.length === 0) return 0.0;

    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    // Use a simple similarity algorithm (Levenshtein distance normalized)
    const distance = this.levenshteinDistance(longer.toLowerCase(), shorter.toLowerCase());
    return 1 - (distance / longer.length);
  }

  /**
   * Calculate Levenshtein distance
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = Array(str2.length + 1).fill(0).map(() => Array(str1.length + 1).fill(0));

    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1, // insertion
          matrix[j - 1][i] + 1, // deletion
          matrix[j - 1][i - 1] + indicator // substitution
        );
      }
    }

    return matrix[str2.length][str1.length] || 0;
  }

  /**
   * Validates context boundaries to prevent context injection
   */
  validateContextBoundary(prompt: string, context?: string): GuardResult {
    if (!this.config.contextBoundaryEnforcement || !context) {
      return { allowed: true, confidence: 1.0 };
    }

    // Check if the prompt tries to escape or manipulate the context
    const patterns = [
      /end[\s_\-]*context/i,
      /stop[\s_\-]*context/i,
      /ignore[\s_\-]*context/i,
      /context[\s_\-]*end/i,
      /context[\s_\-]*stop/i,
      /<\s*\/\s*context\s*>/i,
    ];

    for (const pattern of patterns) {
      if (pattern.test(prompt)) {
        return {
          allowed: false,
          reason: 'Prompt attempts to break context boundaries',
          confidence: 0.9
        };
      }
    }

    return { allowed: true, confidence: 1.0 };
  }
}

/**
 * Middleware for securing knowledge base operations
 */
export const knowledgeBaseSecurityMiddleware = async (c: Context, next: () => Promise<void>) => {
  const securityService = c.get('knowledgeBaseSecurityService');
  
  if (securityService && c.req.path.includes('/kb/')) {
    if (c.req.method === 'POST' || c.req.method === 'PUT') {
      const body = await c.req.json().catch(() => ({}));
      
      // Check for content in request body
      let content = body.content || body.text || body.data || body.query;
      
      if (content) {
        const validation = await securityService.validateInput(content);
        
        if (!validation.allowed) {
          return c.json(
            { 
              error: 'Knowledge base input validation failed', 
              reason: validation.reason,
              confidence: validation.confidence
            }, 
            400
          );
        }

        // Update the request body with sanitized input if provided
        if (validation.sanitizedInput) {
          c.set('sanitizedContent', validation.sanitizedInput);
        }
      }
    }
  }
  
  await next();
};

/**
 * Initialize knowledge base security service
 */
export const initializeKnowledgeBaseSecurity = async (c: Context, next: () => Promise<void>) => {
  const aiGuardrailsService = c.get('aiGuardrailsService');
  
  const securityConfig = {
    maxInputLength: parseInt(c.env?.KB_MAX_INPUT_LENGTH || process.env.KB_MAX_INPUT_LENGTH || '400'),
    blockedKeywords: (c.env?.KB_BLOCKED_KEYWORDS || process.env.KB_BLOCKED_KEYWORDS || 'prompt injection,ignore instructions')
      .split(',')
      .map(keyword => keyword.trim()),
    similarityThreshold: parseFloat(c.env?.KB_SIMILARITY_THRESHOLD || process.env.KB_SIMILARITY_THRESHOLD || '0.8'),
    contextBoundaryEnforcement: c.env?.KB_CONTEXT_BOUNDARY_ENFORCEMENT === 'true' || process.env.KB_CONTEXT_BOUNDARY_ENFORCEMENT === 'true',
    rateLimit: parseInt(c.env?.KB_RATE_LIMIT || process.env.KB_RATE_LIMIT || '100'),
  };

  const securityService = new KnowledgeBaseSecurityService(securityConfig, aiGuardrailsService);
  c.set('knowledgeBaseSecurityService', securityService);
  
  await next();
};