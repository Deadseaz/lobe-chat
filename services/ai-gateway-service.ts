/**
 * Enhanced Cloudflare AI Gateway Service
 * Advanced AI model routing, fallback management, and intelligent request handling
 */

import { Context } from 'hono';
import { AIGuardrailsService } from '../shared/middleware.js';

export interface AIModelConfig {
  id: string;
  provider: 'openai' | 'anthropic' | 'google' | 'cloudflare' | 'aws' | 'azure';
  model: string;
  apiKey: string;
  endpoint?: string;
  maxTokens?: number;
  temperature?: number;
  fallbackEnabled: boolean;
  performanceRating: number; // 0-100 based on performance metrics
  costPerToken: number; // in USD
  rateLimit: number; // requests per minute
  status: 'active' | 'disabled' | 'degraded';
  lastTested: Date;
}

export interface AIRequest {
  modelId: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, any>;
}

export interface AIResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  modelProvider: string;
  responseTime: number; // milliseconds
  cost: number; // in USD
  timestamp: Date;
}

export interface FallbackChain {
  id: string;
  name: string;
  models: string[]; // ordered list of model IDs in fallback order
  strategy: 'immediate' | 'threshold' | 'circuit-breaker';
  threshold: number; // error rate or response time threshold
  createdAt: Date;
}

export interface AIAnalytics {
  modelId: string;
  requests: number;
  successRate: number;
  avgResponseTime: number;
  tokensUsed: number;
  cost: number;
  timestamp: Date;
}

export interface IntelligentRoutingRule {
  id: string;
  name: string;
  condition: {
    type: 'content-type' | 'user-type' | 'context' | 'performance' | 'cost';
    value: string;
  };
  targetModel: string;
  priority: number; // 1-10, with 10 being highest
  enabled: boolean;
  createdAt: Date;
}

export class CloudflareAIGatewayService {
  private models: Map<string, AIModelConfig> = new Map();
  private fallbackChains: Map<string, FallbackChain> = new Map();
  private routingRules: Map<string, IntelligentRoutingRule> = new Map();
  private analytics: Map<string, AIAnalytics[]> = new Map();
  private aiGuardrails: AIGuardrailsService;
  private requestHistory: Array<{ id: string; request: AIRequest; response?: AIResponse; timestamp: Date }> = [];
  private circuitBreakers: Map<string, { failures: number; lastFailure: Date; state: 'closed' | 'open' | 'half-open' }> = new Map();

  constructor(aiGuardrails: AIGuardrailsService) {
    this.aiGuardrails = aiGuardrails;
    this.initializeDefaultModels();
    this.startAnalyticsCollection();
  }

  private initializeDefaultModels(): void {
    // Initialize with common Cloudflare Workers AI models
    const defaultModels: AIModelConfig[] = [
      {
        id: 'cf@cf/meta/llama-2-7b-chat-fp16',
        provider: 'cloudflare',
        model: '@cf/meta/llama-2-7b-chat-fp16',
        apiKey: process.env.CF_API_TOKEN || '',
        maxTokens: 2048,
        temperature: 0.7,
        fallbackEnabled: true,
        performanceRating: 85,
        costPerToken: 0.0000001,
        rateLimit: 1000,
        status: 'active',
        lastTested: new Date()
      },
      {
        id: 'cf@cf/meta/llama-2-7b-chat-int8',
        provider: 'cloudflare',
        model: '@cf/meta/llama-2-7b-chat-int8',
        apiKey: process.env.CF_API_TOKEN || '',
        maxTokens: 2048,
        temperature: 0.7,
        fallbackEnabled: true,
        performanceRating: 80,
        costPerToken: 0.00000005,
        rateLimit: 1000,
        status: 'active',
        lastTested: new Date()
      },
      {
        id: 'cf@cf/baai/bge-large-en-v1.5',
        provider: 'cloudflare',
        model: '@cf/baai/bge-large-en-v1.5',
        apiKey: process.env.CF_API_TOKEN || '',
        maxTokens: 512,
        temperature: 0.0,
        fallbackEnabled: false,
        performanceRating: 95,
        costPerToken: 0.00000002,
        rateLimit: 1000,
        status: 'active',
        lastTested: new Date()
      }
    ];

    for (const model of defaultModels) {
      this.models.set(model.id, model);
    }
  }

  /**
   * Create a new AI model configuration
   */
  async createModelConfig(config: Omit<AIModelConfig, 'id' | 'lastTested' | 'performanceRating'>): Promise<AIModelConfig> {
    const modelId = crypto.randomUUID?.() || `model-${Date.now()}`;
    const modelConfig: AIModelConfig = {
      ...config,
      id: modelId,
      performanceRating: 50, // Default rating
      lastTested: new Date()
    };

    // Validate the API key by making a test request if possible
    try {
      await this.testModelConfig(modelConfig);
    } catch (error) {
      console.warn(`Model ${modelId} failed initial test: ${error}`);
    }

    this.models.set(modelId, modelConfig);
    return modelConfig;
  }

  /**
   * Test a model configuration
   */
  private async testModelConfig(config: AIModelConfig): Promise<boolean> {
    try {
      // Perform a simple test request based on the provider
      switch (config.provider) {
        case 'cloudflare':
          await this.testCloudflareModel(config);
          break;
        case 'openai':
          await this.testOpenAIModel(config);
          break;
        case 'anthropic':
          await this.testAnthropicModel(config);
          break;
        case 'google':
          await this.testGoogleModel(config);
          break;
        case 'aws':
          await this.testAWSModel(config);
          break;
        case 'azure':
          await this.testAzureModel(config);
          break;
        default:
          throw new Error(`Unsupported provider: ${config.provider}`);
      }

      // Update model status and performance rating
      const model = this.models.get(config.id);
      if (model) {
        model.status = 'active';
        model.lastTested = new Date();
        model.performanceRating = Math.min(100, model.performanceRating + 5); // Improve rating on success
      }

      return true;
    } catch (error) {
      // Update model status
      const model = this.models.get(config.id);
      if (model) {
        model.status = 'degraded';
        model.lastTested = new Date();
        model.performanceRating = Math.max(0, model.performanceRating - 10); // Decrease rating on failure
      }

      throw error;
    }
  }

  /**
   * Test Cloudflare model
   */
  private async testCloudflareModel(config: AIModelConfig): Promise<void> {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/ai/run/${config.model}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: 'Hello, this is a test'
      })
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Cloudflare model test failed: ${errorData}`);
    }
  }

  /**
   * Test OpenAI model (stub implementation)
   */
  private async testOpenAIModel(config: AIModelConfig): Promise<void> {
    // In a real implementation, this would call the OpenAI API
    console.log(`Testing OpenAI model: ${config.model}`);
  }

  /**
   * Test Anthropic model (stub implementation)
   */
  private async testAnthropicModel(config: AIModelConfig): Promise<void> {
    // In a real implementation, this would call the Anthropic API
    console.log(`Testing Anthropic model: ${config.model}`);
  }

  /**
   * Test Google model (stub implementation)
   */
  private async testGoogleModel(config: AIModelConfig): Promise<void> {
    // In a real implementation, this would call the Google API
    console.log(`Testing Google model: ${config.model}`);
  }

  /**
   * Test AWS model (stub implementation)
   */
  private async testAWSModel(config: AIModelConfig): Promise<void> {
    // In a real implementation, this would call the AWS API
    console.log(`Testing AWS model: ${config.model}`);
  }

  /**
   * Test Azure model (stub implementation)
   */
  private async testAzureModel(config: AIModelConfig): Promise<void> {
    // In a real implementation, this would call the Azure API
    console.log(`Testing Azure model: ${config.model}`);
  }

  /**
   * Process an AI request with intelligent routing and fallbacks
   */
  async processRequest(request: AIRequest): Promise<AIResponse> {
    // Validate the request using AI guardrails
    const validation = await this.aiGuardrails.validateInput(JSON.stringify(request.messages));
    if (!validation.allowed) {
      throw new Error(`Request validation failed: ${validation.reason}`);
    }

    // Find the best model for this request
    const modelId = this.selectModelForRequest(request);
    const startTime = Date.now();

    // Track the request
    const requestId = crypto.randomUUID?.() || `req-${Date.now()}`;
    this.requestHistory.push({
      id: requestId,
      request,
      timestamp: new Date()
    });

    try {
      // Check circuit breaker for this model
      if (this.isCircuitOpen(modelId)) {
        // If circuit is open, try fallback chain
        return await this.processRequestWithFallback(request, modelId, startTime);
      }

      // Try primary model first
      const response = await this.callModel(modelId, request);
      const responseTime = Date.now() - startTime;

      // Record success analytics
      this.recordAnalytics(modelId, { 
        success: true, 
        responseTime, 
        tokens: response.usage.total_tokens,
        cost: response.cost
      });

      // Update the request history with response
      const reqHistory = this.requestHistory.find(r => r.id === requestId);
      if (reqHistory) {
        reqHistory.response = response;
      }

      return response;
    } catch (error) {
      const responseTime = Date.now() - startTime;

      // Record failure analytics
      this.recordAnalytics(modelId, { 
        success: false, 
        responseTime, 
        tokens: 0,
        cost: 0
      });

      // Update circuit breaker
      this.updateCircuitBreaker(modelId, false);

      // Try fallback chain
      return await this.processRequestWithFallback(request, modelId, startTime);
    }
  }

  /**
   * Process request with fallback chain
   */
  private async processRequestWithFallback(request: AIRequest, primaryModelId: string, startTime: number): Promise<AIResponse> {
    // Find applicable fallback chain
    const fallbackChain = this.findFallbackChain(primaryModelId);
    if (!fallbackChain) {
      throw new Error(`No fallback available for model ${primaryModelId}`);
    }

    const availableModels = fallbackChain.models.filter(id => {
      const model = this.models.get(id);
      return model && model.status === 'active' && id !== primaryModelId;
    });

    for (const modelId of availableModels) {
      try {
        const response = await this.callModel(modelId, request);
        const responseTime = Date.now() - startTime;

        // Record success analytics
        this.recordAnalytics(modelId, { 
          success: true, 
          responseTime, 
          tokens: response.usage.total_tokens,
          cost: response.cost
        });

        // Update circuit breaker for primary model
        this.updateCircuitBreaker(primaryModelId, true);

        return response;
      } catch (error) {
        const responseTime = Date.now() - startTime;
        
        // Record failure analytics
        this.recordAnalytics(modelId, { 
          success: false, 
          responseTime, 
          tokens: 0,
          cost: 0
        });

        // Update circuit breaker
        this.updateCircuitBreaker(modelId, false);
        
        console.warn(`Fallback model ${modelId} failed:`, error);
      }
    }

    throw new Error(`All models in fallback chain failed for original model ${primaryModelId}`);
  }

  /**
   * Call a specific model
   */
  private async callModel(modelId: string, request: AIRequest): Promise<AIResponse> {
    const model = this.models.get(modelId);
    if (!model) {
      throw new Error(`Model ${modelId} not found`);
    }

    if (model.status !== 'active') {
      throw new Error(`Model ${modelId} is not active (${model.status})`);
    }

    const startTime = Date.now();

    try {
      let response: any;

      switch (model.provider) {
        case 'cloudflare':
          response = await this.callCloudflareModel(model, request);
          break;
        case 'openai':
          response = await this.callOpenAIModel(model, request);
          break;
        case 'anthropic':
          response = await this.callAnthropicModel(model, request);
          break;
        case 'google':
          response = await this.callGoogleModel(model, request);
          break;
        case 'aws':
          response = await this.callAWSModel(model, request);
          break;
        case 'azure':
          response = await this.callAzureModel(model, request);
          break;
        default:
          throw new Error(`Unsupported provider: ${model.provider}`);
      }

      const responseTime = Date.now() - startTime;

      // Calculate cost based on tokens used
      const tokens = response.usage?.total_tokens || 0;
      const cost = tokens * model.costPerToken;

      return {
        id: crypto.randomUUID?.() || `resp-${Date.now()}`,
        model: model.model,
        choices: response.choices || [{ 
          index: 0, 
          message: { role: 'assistant', content: response.result?.response || 'No response' }, 
          finish_reason: 'stop' 
        }],
        usage: response.usage || { 
          prompt_tokens: 0, 
          completion_tokens: 0, 
          total_tokens: tokens 
        },
        modelProvider: model.provider,
        responseTime,
        cost,
        timestamp: new Date()
      };
    } catch (error) {
      throw new Error(`Model ${modelId} call failed: ${error}`);
    }
  }

  /**
   * Call Cloudflare model
   */
  private async callCloudflareModel(model: AIModelConfig, request: AIRequest): Promise<any> {
    // For text generation models
    if (model.model.includes('llama') || model.model.includes('mistral')) {
      const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/ai/run/${model.model}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${model.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt: this.formatMessagesToPrompt(request.messages),
          max_tokens: request.maxTokens || model.maxTokens || 2048,
          temperature: request.temperature || model.temperature || 0.7
        })
      });

      if (!response.ok) {
        throw new Error(`Cloudflare API error: ${response.status} ${await response.text()}`);
      }

      return await response.json();
    } 
    // For embedding models
    else if (model.model.includes('bge')) {
      const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/ai/run/${model.model}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${model.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: request.messages[0]?.content || 'Hello'
        })
      });

      if (!response.ok) {
        throw new Error(`Cloudflare API error: ${response.status} ${await response.text()}`);
      }

      return await response.json();
    }

    throw new Error(`Unsupported Cloudflare model: ${model.model}`);
  }

  /**
   * Call OpenAI model (stub implementation)
   */
  private async callOpenAIModel(model: AIModelConfig, request: AIRequest): Promise<any> {
    // In a real implementation, this would call the OpenAI API
    console.log(`Calling OpenAI model: ${model.model}`);
    return {
      choices: [{ 
        index: 0, 
        message: { role: 'assistant', content: 'OpenAI model response' }, 
        finish_reason: 'stop' 
      }],
      usage: { 
        prompt_tokens: 10, 
        completion_tokens: 20, 
        total_tokens: 30 
      }
    };
  }

  /**
   * Call Anthropic model (stub implementation)
   */
  private async callAnthropicModel(model: AIModelConfig, request: AIRequest): Promise<any> {
    // In a real implementation, this would call the Anthropic API
    console.log(`Calling Anthropic model: ${model.model}`);
    return {
      choices: [{ 
        index: 0, 
        message: { role: 'assistant', content: 'Anthropic model response' }, 
        finish_reason: 'stop' 
      }],
      usage: { 
        prompt_tokens: 15, 
        completion_tokens: 25, 
        total_tokens: 40 
      }
    };
  }

  /**
   * Call Google model (stub implementation)
   */
  private async callGoogleModel(model: AIModelConfig, request: AIRequest): Promise<any> {
    // In a real implementation, this would call the Google API
    console.log(`Calling Google model: ${model.model}`);
    return {
      choices: [{ 
        index: 0, 
        message: { role: 'assistant', content: 'Google model response' }, 
        finish_reason: 'stop' 
      }],
      usage: { 
        prompt_tokens: 12, 
        completion_tokens: 22, 
        total_tokens: 34 
      }
    };
  }

  /**
   * Call AWS model (stub implementation)
   */
  private async callAWSModel(model: AIModelConfig, request: AIRequest): Promise<any> {
    // In a real implementation, this would call the AWS API
    console.log(`Calling AWS model: ${model.model}`);
    return {
      choices: [{ 
        index: 0, 
        message: { role: 'assistant', content: 'AWS model response' }, 
        finish_reason: 'stop' 
      }],
      usage: { 
        prompt_tokens: 14, 
        completion_tokens: 24, 
        total_tokens: 38 
      }
    };
  }

  /**
   * Call Azure model (stub implementation)
   */
  private async callAzureModel(model: AIModelConfig, request: AIRequest): Promise<any> {
    // In a real implementation, this would call the Azure API
    console.log(`Calling Azure model: ${model.model}`);
    return {
      choices: [{ 
        index: 0, 
        message: { role: 'assistant', content: 'Azure model response' }, 
        finish_reason: 'stop' 
      }],
      usage: { 
        prompt_tokens: 11, 
        completion_tokens: 21, 
        total_tokens: 32 
      }
    };
  }

  /**
   * Select the best model for a request
   */
  private selectModelForRequest(request: AIRequest): string {
    // First, check if any routing rules apply
    const applicableRule = this.findApplicableRoutingRule(request);
    if (applicableRule) {
      return applicableRule.targetModel;
    }

    // Otherwise, select based on performance and cost
    const allModels = Array.from(this.models.values())
      .filter(model => model.status === 'active' && model.fallbackEnabled);

    if (allModels.length === 0) {
      throw new Error('No active models available');
    }

    // Select the model with the best performance-to-cost ratio
    const bestModel = allModels.reduce((best, current) => {
      const bestRatio = best.performanceRating / best.costPerToken;
      const currentRatio = current.performanceRating / current.costPerToken;
      
      // Prefer models with higher performance-to-cost ratio
      return currentRatio > bestRatio ? current : best;
    });

    return bestModel.id;
  }

  /**
   * Find applicable routing rule
   */
  private findApplicableRoutingRule(request: AIRequest): IntelligentRoutingRule | null {
    // Sort rules by priority (highest first)
    const sortedRules = Array.from(this.routingRules.values())
      .filter(rule => rule.enabled)
      .sort((a, b) => b.priority - a.priority);

    for (const rule of sortedRules) {
      if (this.ruleApplies(rule, request)) {
        return rule;
      }
    }

    return null;
  }

  /**
   * Check if a rule applies to a request
   */
  private ruleApplies(rule: IntelligentRoutingRule, request: AIRequest): boolean {
    switch (rule.condition.type) {
      case 'content-type':
        // Check if content contains certain keywords
        const content = request.messages.map(m => m.content).join(' ');
        return content.toLowerCase().includes(rule.condition.value.toLowerCase());
      
      case 'user-type':
        return request.userId?.includes(rule.condition.value) || false;
      
      case 'context':
        // Check if any message contains the context
        return request.messages.some(m => 
          m.content.toLowerCase().includes(rule.condition.value.toLowerCase())
        );
      
      default:
        return false;
    }
  }

  /**
   * Create a fallback chain
   */
  async createFallbackChain(config: Omit<FallbackChain, 'id' | 'createdAt'>): Promise<FallbackChain> {
    const chainId = crypto.randomUUID?.() || `chain-${Date.now()}`;
    const fallbackChain: FallbackChain = {
      ...config,
      id: chainId,
      createdAt: new Date()
    };

    this.fallbackChains.set(chainId, fallbackChain);
    return fallbackChain;
  }

  /**
   * Find fallback chain for a model
   */
  private findFallbackChain(modelId: string): FallbackChain | undefined {
    for (const chain of this.fallbackChains.values()) {
      if (chain.models.includes(modelId)) {
        return chain;
      }
    }
    return undefined;
  }

  /**
   * Create intelligent routing rule
   */
  async createRoutingRule(rule: Omit<IntelligentRoutingRule, 'id' | 'createdAt'>): Promise<IntelligentRoutingRule> {
    const ruleId = crypto.randomUUID?.() || `rule-${Date.now()}`;
    const routingRule: IntelligentRoutingRule = {
      ...rule,
      id: ruleId,
      createdAt: new Date()
    };

    this.routingRules.set(ruleId, routingRule);
    return routingRule;
  }

  /**
   * Record analytics for a model
   */
  private recordAnalytics(modelId: string, result: { success: boolean; responseTime: number; tokens: number; cost: number }): void {
    if (!this.analytics.has(modelId)) {
      this.analytics.set(modelId, []);
    }

    const modelAnalytics = this.analytics.get(modelId)!;
    const now = new Date();
    
    // Create/update the daily analytics entry
    const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    let dailyAnalytics = modelAnalytics.find(a => 
      a.timestamp.toDateString() === now.toDateString()
    );

    if (!dailyAnalytics) {
      dailyAnalytics = {
        modelId,
        requests: 0,
        successRate: 0,
        avgResponseTime: 0,
        tokensUsed: 0,
        cost: 0,
        timestamp: now
      };
      modelAnalytics.push(dailyAnalytics);
    }

    // Update the daily analytics
    dailyAnalytics.requests += 1;
    dailyAnalytics.tokensUsed += result.tokens;
    dailyAnalytics.cost += result.cost;

    if (result.success) {
      const totalSuccess = modelAnalytics.reduce((sum, a) => sum + (a.successRate > 0 ? 1 : 0), 0);
      const successfulRequests = modelAnalytics.reduce((sum, a) => sum + Math.round(a.requests * (a.successRate / 100)), 0);
      dailyAnalytics.successRate = (successfulRequests / dailyAnalytics.requests) * 100;
    } else {
      dailyAnalytics.successRate = ((dailyAnalytics.requests - 1) / dailyAnalytics.requests) * 100;
    }

    // Update response time average
    const totalTime = modelAnalytics.reduce((sum, a) => sum + a.avgResponseTime * a.requests, 0);
    const totalRequests = modelAnalytics.reduce((sum, a) => sum + a.requests, 0);
    dailyAnalytics.avgResponseTime = totalTime / totalRequests;

    // Keep only last 30 days of analytics
    if (modelAnalytics.length > 30) {
      modelAnalytics.shift();
    }
  }

  /**
   * Start analytics collection
   */
  private startAnalyticsCollection(): void {
    // Collect usage metrics every 15 minutes
    setInterval(() => {
      this.collectUsageMetrics();
    }, 900000); // 15 minutes
  }

  /**
   * Collect usage metrics
   */
  private collectUsageMetrics(): void {
    // Update model performance ratings based on recent usage
    for (const [modelId, model] of this.models) {
      const modelAnalytics = this.analytics.get(modelId) || [];
      if (modelAnalytics.length === 0) continue;

      // Calculate performance based on success rate, response time, and cost
      const recentAnalytics = modelAnalytics.slice(-7); // Last 7 days
      if (recentAnalytics.length === 0) continue;

      const avgSuccessRate = recentAnalytics.reduce((sum, a) => sum + a.successRate, 0) / recentAnalytics.length;
      const avgResponseTime = recentAnalytics.reduce((sum, a) => sum + a.avgResponseTime, 0) / recentAnalytics.length;
      const avgCost = recentAnalytics.reduce((sum, a) => sum + a.cost / a.requests, 0) / recentAnalytics.length;

      // Performance rating based on: success rate, response time (inversely), and cost (inversely)
      // Range from 0-100
      let performance = (avgSuccessRate / 100) * 40; // Success rate contributes 40%
      performance += ((1000 - Math.min(avgResponseTime, 1000)) / 1000) * 30; // Response time contributes 30%
      performance += ((0.01 - Math.min(avgCost, 0.01)) / 0.01) * 30; // Cost contributes 30%
      
      model.performanceRating = Math.round(performance);
    }
  }

  /**
   * Get model analytics
   */
  getModelAnalytics(modelId: string, days: number = 7): AIAnalytics[] {
    const allAnalytics = this.analytics.get(modelId) || [];
    return allAnalytics.slice(-days);
  }

  /**
   * Get all model analytics
   */
  getAllModelAnalytics(): { [modelId: string]: AIAnalytics[] } {
    const result: { [modelId: string]: AIAnalytics[] } = {};
    
    for (const [modelId, analytics] of this.analytics) {
      result[modelId] = analytics.slice(-7); // Last 7 days
    }
    
    return result;
  }

  /**
   * Get model by ID
   */
  getModel(modelId: string): AIModelConfig | undefined {
    return this.models.get(modelId);
  }

  /**
   * Get all models
   */
  getAllModels(): AIModelConfig[] {
    return Array.from(this.models.values());
  }

  /**
   * Update model configuration
   */
  async updateModelConfig(modelId: string, updates: Partial<AIModelConfig>): Promise<AIModelConfig | null> {
    const model = this.models.get(modelId);
    if (!model) {
      return null;
    }

    // Apply updates
    Object.assign(model, updates);

    // Test the updated configuration if API key changed
    if (updates.apiKey || updates.endpoint) {
      try {
        await this.testModelConfig(model);
      } catch (error) {
        console.warn(`Updated model ${modelId} failed test: ${error}`);
        return model;
      }
    }

    return model;
  }

  /**
   * Check if circuit breaker is open for a model
   */
  private isCircuitOpen(modelId: string): boolean {
    const breaker = this.circuitBreakers.get(modelId);
    if (!breaker) return false;

    if (breaker.state === 'closed') return false;
    if (breaker.state === 'open') {
      // After 1 minute, move to half-open state
      if (Date.now() - breaker.lastFailure.getTime() > 60000) {
        this.circuitBreakers.set(modelId, {
          ...breaker,
          state: 'half-open'
        });
        return false; // Allow one request in half-open state
      }
      return true;
    }

    // In half-open state - allow one request, then open if it fails
    return false;
  }

  /**
   * Update circuit breaker state
   */
  private updateCircuitBreaker(modelId: string, success: boolean): void {
    const current = this.circuitBreakers.get(modelId) || {
      failures: 0,
      lastFailure: new Date(0),
      state: 'closed'
    };

    if (success) {
      // Reset on success
      this.circuitBreakers.set(modelId, {
        failures: 0,
        lastFailure: new Date(0),
        state: 'closed'
      });
    } else {
      // Increment failures
      const newFailures = current.failures + 1;
      const newState = newFailures >= 5 ? 'open' : current.state; // Open after 5 failures

      this.circuitBreakers.set(modelId, {
        failures: newFailures,
        lastFailure: new Date(),
        state: newState
      });
    }
  }

  /**
   * Format messages to a single prompt string
   */
  private formatMessagesToPrompt(messages: Array<{ role: string; content: string }>): string {
    return messages.map(msg => `${msg.role}: ${msg.content}`).join('\n');
  }

  /**
   * Get AI gateway statistics
   */
  getAIGatewayStats(): {
    totalModels: number;
    activeModels: number;
    totalRequests: number;
    successRate: number;
    totalCost: number;
  } {
    const models = Array.from(this.models.values());
    const activeModels = models.filter(m => m.status === 'active').length;
    
    const totalRequests = this.requestHistory.length;
    const successfulRequests = this.requestHistory.filter(r => r.response).length;
    const successRate = totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 0;
    
    const totalCost = this.requestHistory
      .filter(r => r.response)
      .reduce((sum, r) => sum + (r.response?.cost || 0), 0);

    return {
      totalModels: models.length,
      activeModels,
      totalRequests,
      successRate,
      totalCost
    };
  }
}

/**
 * Initialize AI Gateway service middleware
 */
export const initializeAIGateway = async (c: Context, next: () => Promise<void>) => {
  const aiGuardrailsService = c.get('aiGuardrailsService');

  if (!aiGuardrailsService) {
    console.error('AI Guardrails service not initialized for AI Gateway');
    throw new Error('AI Guardrails service required for AI Gateway');
  }

  const aiGatewayService = new CloudflareAIGatewayService(aiGuardrailsService);
  c.set('aiGatewayService', aiGatewayService);

  await next();
};