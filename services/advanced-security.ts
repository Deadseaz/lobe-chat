/**
 * Advanced Security Service for zagent
 * Provides enhanced prompt injection protection and comprehensive security measures
 */

import { Context } from 'hono';
import { AIGuardrailsService } from '../shared/middleware';
import { ConfigService } from '../shared/config';

export interface SecurityRule {
  id: string;
  name: string;
  description: string;
  pattern: string | RegExp;
  severity: 'low' | 'medium' | 'high' | 'critical';
  action: 'allow' | 'block' | 'quarantine' | 'sanitize';
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SecurityAnalysisResult {
  allowed: boolean;
  confidence: number;
  threats: SecurityThreat[];
  sanitizedContent?: string;
  riskScore: number;
  ruleMatches: string[];
}

export interface SecurityThreat {
  id: string;
  type: 'prompt-injection' | 'data-exfiltration' | 'command-injection' | 'sql-injection' | 'xss' | 'context-injection';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  confidence: number;
  context: string;
}

export interface ThreatIntelligence {
  knownPatterns: string[];
  reputationScores: Record<string, number>;
  blocklist: string[];
  allowlist: string[];
}

export class AdvancedSecurityService {
  private aiGuardrails: AIGuardrailsService;
  private configService: ConfigService;
  private securityRules: SecurityRule[] = [];
  private threatIntelligence: ThreatIntelligence;
  private contentFilters: Map<string, Function> = new Map();
  private behavioralAnalyzer: any; // Would be a more sophisticated implementation in real system

  constructor(aiGuardrails: AIGuardrailsService, configService: ConfigService) {
    this.aiGuardrails = aiGuardrails;
    this.configService = configService;
    
    // Initialize threat intelligence
    this.threatIntelligence = {
      knownPatterns: [
        'ignore the above',
        'disregard previous instructions',
        'system prompt',
        'instruction override',
        '### Instruction',
        '### System', 
        '### Assistant',
        '### User',
        'end of context',
        'stop context',
        'context boundary',
        'new system',
        'role play as',
        'act as',
        'pretend to be',
        'jailbreak',
        'ignore all',
        'but actually',
        'never mind',
        'however,',
        'on second thought',
        'wait,',
        'actually,',
        'disregard',
        'bypass',
        'evade',
        'circumvent',
        'escape',
        'newline injection',
        'char injection',
        'template injection',
        'prompt manipulation'
      ],
      reputationScores: {},
      blocklist: [],
      allowlist: []
    };
    
    // Initialize security rules
    this.initializeSecurityRules();
    
    // Initialize content filters
    this.initializeContentFilters();
  }

  private initializeSecurityRules(): void {
    // Add default security rules
    this.securityRules = [
      {
        id: 'rule-prompt-injection-1',
        name: 'Prompt Injection Detection',
        description: 'Detects common prompt injection patterns',
        pattern: /ignore\s+(the\s+)?(above|previous|instructions)/gi,
        severity: 'high',
        action: 'block',
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'rule-context-boundary-1', 
        name: 'Context Boundary Violation',
        description: 'Detects attempts to break context boundaries',
        pattern: /end\s*context|stop\s*context|ignore\s*context|context\s*end/gi,
        severity: 'high',
        action: 'block',
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'rule-role-injection-1',
        name: 'Role Injection',
        description: 'Detects attempts to change AI role',
        pattern: /(act\s+as|role\s+play|pretend\s+to\s+be|you\s+are\s+now)/gi,
        severity: 'medium',
        action: 'quarantine',
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'rule-command-injection-1',
        name: 'Command Injection',
        description: 'Detects potential command injection patterns',
        pattern: /(\|\||&&|;|`|\\$\\(.*?\\)|%.*?%)/g,
        severity: 'high',
        action: 'block',
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'rule-data-exfil-1',
        name: 'Data Exfiltration',
        description: 'Detects attempts to extract system information',
        pattern: /(system\s+info|environment\s+vars|config\s+data|api\s+keys|secrets)/gi,
        severity: 'critical',
        action: 'block',
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];
  }

  private initializeContentFilters(): void {
    // Add content sanitization filters
    this.contentFilters.set('xss-filter', (content: string): string => {
      // Remove potential XSS patterns
      return content
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '[REMOVED SCRIPT]')
        .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '[REMOVED IFRAME]')
        .replace(/javascript:/gi, 'javascript-disabled:')
        .replace(/on\w+\s*=/gi, 'disabled-$&');
    });

    this.contentFilters.set('command-filter', (content: string): string => {
      // Remove potential command injection patterns
      return content
        .replace(/\|\|/g, ' ')
        .replace(/&&/g, ' ')
        .replace(/\;/g, ' ')
        .replace(/\`.*?\`/g, '[REMOVED]')
        .replace(/\$\(\s*.*?\s*\)/g, '[REMOVED]');
    });

    this.contentFilters.set('sql-filter', (content: string): string => {
      // Remove potential SQL injection patterns
      return content
        .replace(/(drop|delete|insert|update|select|create|alter|exec|execute|union|all|or|and)\s+/gi, '$1-disabled ')
        .replace(/(\-\-|\#|\/\*|\*\/)/g, ' ');
    });

    this.contentFilters.set('path-traversal-filter', (content: string): string => {
      // Remove potential path traversal
      return content
        .replace(/\.\.\//g, '')
        .replace(/\.\.\\/g, '')
        .replace(/%2e%2e%2f/g, '')
        .replace(/%2e%2e%5c/g, '');
    });
  }

  /**
   * Perform comprehensive security analysis on input content
   */
  async analyzeContent(content: string): Promise<SecurityAnalysisResult> {
    const threats: SecurityThreat[] = [];
    const ruleMatches: string[] = [];
    let riskScore = 0;
    let highestSeverity: 'low' | 'medium' | 'high' | 'critical' = 'low';
    
    // Check against known threat patterns
    for (const pattern of this.threatIntelligence.knownPatterns) {
      if (content.toLowerCase().includes(pattern.toLowerCase())) {
        const threat: SecurityThreat = {
          id: `threat-${Date.now()}-${Math.random()}`,
          type: this.classifyThreat(pattern),
          severity: this.assessThreatSeverity(pattern),
          description: `Known threat pattern detected: ${pattern}`,
          confidence: 0.8,
          context: pattern
        };
        
        threats.push(threat);
        riskScore += this.calculateRiskScore(threat.severity);
        
        if (this.isHigherSeverity(threat.severity, highestSeverity)) {
          highestSeverity = threat.severity;
        }
      }
    }
    
    // Check against security rules
    for (const rule of this.securityRules) {
      if (!rule.enabled) continue;
      
      const pattern = typeof rule.pattern === 'string' 
        ? new RegExp(rule.pattern, 'gi') 
        : rule.pattern;
      
      const matches = content.match(pattern);
      if (matches) {
        ruleMatches.push(rule.id);
        
        const threat: SecurityThreat = {
          id: `threat-rule-${rule.id}`,
          type: this.classifyThreat(rule.description),
          severity: rule.severity,
          description: `Security rule violation: ${rule.name} (${rule.description})`,
          confidence: 0.9,
          context: matches.join(', ')
        };
        
        threats.push(threat);
        riskScore += this.calculateRiskScore(threat.severity);
        
        if (this.isHigherSeverity(threat.severity, highestSeverity)) {
          highestSeverity = threat.severity;
        }
      }
    }
    
    // Use AI guardrails as additional check
    const aiValidation = await this.aiGuardrails.validateInput(content);
    if (!aiValidation.allowed && aiValidation.reason) {
      const aiThreat: SecurityThreat = {
        id: `threat-ai-guard-${Date.now()}`,
        type: 'prompt-injection',
        severity: 'high',
        description: `AI Guardrail violation: ${aiValidation.reason}`,
        confidence: 0.95,
        context: aiValidation.reason
      };
      
      threats.push(aiThreat);
      riskScore += this.calculateRiskScore('high');
      
      if (this.isHigherSeverity('high', highestSeverity)) {
        highestSeverity = 'high';
      }
    }
    
    // Determine if content is allowed based on risk score and severity
    const allowed = riskScore < 5.0; // Threshold can be configured
    const confidence = allowed ? 1.0 - (riskScore / 10.0) : riskScore / 10.0;
    
    // Sanitize content if needed
    let sanitizedContent: string | undefined;
    if (!allowed && highestSeverity !== 'critical') {
      sanitizedContent = this.sanitizeContent(content);
    }
    
    return {
      allowed,
      confidence,
      threats,
      sanitizedContent,
      riskScore,
      ruleMatches
    };
  }

  /**
   * Classify threat type based on pattern
   */
  private classifyThreat(pattern: string): 'prompt-injection' | 'data-exfiltration' | 'command-injection' | 'sql-injection' | 'xss' | 'context-injection' {
    const lowerPattern = pattern.toLowerCase();
    
    if (lowerPattern.includes('ignore') || lowerPattern.includes('disregard') || lowerPattern.includes('system prompt')) {
      return 'prompt-injection';
    } else if (lowerPattern.includes('system') || lowerPattern.includes('config') || lowerPattern.includes('api key')) {
      return 'data-exfiltration';
    } else if (lowerPattern.includes('|') || lowerPattern.includes(';') || lowerPattern.includes('exec')) {
      return 'command-injection';
    } else if (lowerPattern.includes('select') || lowerPattern.includes('drop') || lowerPattern.includes('union')) {
      return 'sql-injection';
    } else if (lowerPattern.includes('script') || lowerPattern.includes('javascript')) {
      return 'xss';
    } else if (lowerPattern.includes('context') || lowerPattern.includes('boundary')) {
      return 'context-injection';
    }
    
    return 'prompt-injection'; // Default classification
  }

  /**
   * Assess threat severity based on pattern
   */
  private assessThreatSeverity(pattern: string): 'low' | 'medium' | 'high' | 'critical' {
    const lowerPattern = pattern.toLowerCase();
    
    if (lowerPattern.includes('critical') || lowerPattern.includes('secrets') || lowerPattern.includes('private')) {
      return 'critical';
    } else if (lowerPattern.includes('ignore') || lowerPattern.includes('disregard') || lowerPattern.includes('bypass')) {
      return 'high';
    } else if (lowerPattern.includes('role') || lowerPattern.includes('act as')) {
      return 'medium';
    } else {
      return 'low';
    }
  }

  /**
   * Calculate risk score based on severity
   */
  private calculateRiskScore(severity: 'low' | 'medium' | 'high' | 'critical'): number {
    switch (severity) {
      case 'critical': return 4.0;
      case 'high': return 3.0;
      case 'medium': return 2.0;
      case 'low': return 1.0;
      default: return 0.5;
    }
  }

  /**
   * Compare threat severities
   */
  private isHigherSeverity(a: string, b: string): boolean {
    const severityOrder = ['low', 'medium', 'high', 'critical'];
    return severityOrder.indexOf(a) > severityOrder.indexOf(b);
  }

  /**
   * Sanitize content using registered filters
   */
  private sanitizeContent(content: string): string {
    let sanitized = content;
    
    for (const [, filter] of this.contentFilters) {
      sanitized = filter(sanitized);
    }
    
    // Additional general sanitization
    sanitized = sanitized.trim();
    sanitized = sanitized.replace(/\s+/g, ' ');
    
    return sanitized;
  }

  /**
   * Add a new security rule
   */
  addSecurityRule(rule: Omit<SecurityRule, 'id' | 'createdAt' | 'updatedAt'>): SecurityRule {
    const newRule: SecurityRule = {
      ...rule,
      id: `rule-${Date.now()}-${Math.random()}`,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    this.securityRules.push(newRule);
    return newRule;
  }

  /**
   * Remove a security rule
   */
  removeSecurityRule(ruleId: string): boolean {
    const index = this.securityRules.findIndex(rule => rule.id === ruleId);
    if (index !== -1) {
      this.securityRules.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Update an existing security rule
   */
  updateSecurityRule(ruleId: string, updates: Partial<Omit<SecurityRule, 'id' | 'createdAt' | 'updatedAt'>>): SecurityRule | null {
    const ruleIndex = this.securityRules.findIndex(rule => rule.id === ruleId);
    if (ruleIndex !== -1) {
      const oldRule = this.securityRules[ruleIndex];
      const updatedRule: SecurityRule = {
        ...oldRule,
        ...updates,
        id: oldRule.id,
        createdAt: oldRule.createdAt,
        updatedAt: new Date()
      };
      this.securityRules[ruleIndex] = updatedRule;
      return updatedRule;
    }
    return null;
  }

  /**
   * Get all security rules
   */
  getSecurityRules(): SecurityRule[] {
    return [...this.securityRules];
  }

  /**
   * Add pattern to threat intelligence blocklist
   */
  addToBlocklist(pattern: string): void {
    if (!this.threatIntelligence.blocklist.includes(pattern)) {
      this.threatIntelligence.blocklist.push(pattern);
    }
  }

  /**
   * Add pattern to threat intelligence allowlist
   */
  addToAllowlist(pattern: string): void {
    if (!this.threatIntelligence.allowlist.includes(pattern)) {
      this.threatIntelligence.allowlist.push(pattern);
    }
  }

  /**
   * Check if content is safe to process
   */
  async isContentSafe(content: string): Promise<{ safe: boolean; reason?: string; sanitizedName?: string }> {
    const analysis = await this.analyzeContent(content);
    
    if (analysis.allowed) {
      return { safe: true };
    }
    
    if (analysis.sanitizedContent) {
      return { 
        safe: true, 
        sanitizedName: analysis.sanitizedContent,
        reason: `Content contained ${analysis.threats.length} threats but was sanitized`
      };
    }
    
    return { 
      safe: false, 
      reason: `Content blocked due to ${analysis.threats.length} detected threats with risk score ${analysis.riskScore.toFixed(2)}`
    };
  }

  /**
   * Get security statistics and metrics
   */
  getSecurityMetrics(): any {
    const totalRules = this.securityRules.length;
    const enabledRules = this.securityRules.filter(r => r.enabled).length;
    const threatTypes = Array.from(new Set(this.securityRules.map(r => this.classifyThreat(r.description))));
    
    return {
      timestamp: new Date(),
      rules: {
        total: totalRules,
        enabled: enabledRules,
        disabled: totalRules - enabledRules,
        types: threatTypes
      },
      threatIntelligence: {
        knownPatterns: this.threatIntelligence.knownPatterns.length,
        blocklist: this.threatIntelligence.blocklist.length,
        allowlist: this.threatIntelligence.allowlist.length
      }
    };
  }

  /**
   * Advanced behavioral analysis for potential threats
   */
  async performBehavioralAnalysis(userId: string, content: string, context?: any): Promise<any> {
    // This would implement more sophisticated analysis in a real system
    // For now, we'll return a basic analysis
    
    const contentLength = content.length;
    const hasSpecialChars = /[{}[\]\\|`^~]/.test(content);
    const hasMultipleNewlines = (content.match(/\n/g) || []).length > 5;
    const hasMixedCase = /[a-z]/.test(content) && /[A-Z]/.test(content);
    
    return {
      userId,
      contentLength,
      hasSpecialChars,
      hasMultipleNewlines,
      hasMixedCase,
      context,
      riskIndicators: [
        ...(hasSpecialChars ? ['special characters'] : []),
        ...(hasMultipleNewlines ? ['multiple newlines'] : []),
        ...(hasMixedCase ? ['mixed case'] : [])
      ],
      riskLevel: this.calculateBehavioralRiskScore({
        contentLength,
        hasSpecialChars,
        hasMultipleNewlines,
        hasMixedCase
      })
    };
  }

  private calculateBehavioralRiskScore(behaviors: { contentLength: number; hasSpecialChars: boolean; hasMultipleNewlines: boolean; hasMixedCase: boolean }): 'low' | 'medium' | 'high' | 'critical' {
    let score = 0;
    
    if (behaviors.contentLength > 1000) score += 1;
    if (behaviors.hasSpecialChars) score += 1;
    if (behaviors.hasMultipleNewlines) score += 1;
    if (behaviors.hasMixedCase) score += 0.5;
    
    if (score >= 3) return 'high';
    if (score >= 2) return 'medium';
    if (score >= 1) return 'low';
    return 'low';
  }
}

// Initialize Advanced Security Service middleware
export const initializeAdvancedSecurity = async (c: Context, next: () => Promise<void>) => {
  const aiGuardrailsService = c.get('aiGuardrailsService');
  const configService = c.get('configService');
  
  if (!aiGuardrailsService || !configService) {
    console.error('AI Guardrails or Config service not initialized for advanced security');
    throw new Error('Required services not available for advanced security');
  }
  
  const advancedSecurityService = new AdvancedSecurityService(aiGuardrailsService, configService);
  c.set('advancedSecurityService', advancedSecurityService);
  
  await next();
};