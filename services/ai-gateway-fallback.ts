/**
 * Enhanced AI Gateway with Robust Fallback Mechanisms
 * Provides multiple AI provider fallbacks and intelligent routing
 */

import { Context } from 'hono';
import { AIGuardrailsService } from '../shared/middleware.js';
import { ConfigService } from '../shared/config.js';

export interface AIFallbackConfig {
  primaryProvider: string;
  fallbackProviders: string[];
  maxRetries: number;
  timeout: number;
  providerWeights: Record<string, number>;
  healthCheckInterval: number;
}

export interface AIProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  healthStatus: 'healthy' | 'degraded' | 'unhealthy';
  lastHealthCheck: Date;
  responseTime: number;
  errorRate: number;
  fallbackPriority: number;
  modelMap: Record<string, string>;
}

export interface AIRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string[];
}

export interface AIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class EnhancedAIGateway {
  private providers: Map<string, AIProviderConfig> = new Map();
  private config: AIFallbackConfig;
  private aiGuardrails: AIGuardrailsService;
  private configService: ConfigService;
  private requestHistory: Array<{ id: string; provider: string; success: boolean; timestamp: Date; responseTime: number }> = [];
  private providerStats: Map<string, { successCount: number; errorCount: number; totalResponseTime: number; requestCount: number }> = new Map();
  
  constructor(config: AIFallbackConfig, aiGuardrails: AIGuardrailsService, configService: ConfigService) {
    this.config = config;
    this.aiGuardrails = aiGuardrails;
    this.configService = configService;
    
    // Initialize providers from environment/config
    this.initializeProviders();
    
    // Start health checks
    this.startHealthChecks();
  }

  private initializeProviders(): void {
    const config = this.configService.getConfig();
    
    // Cloudflare AI Gateway (primary)
    this.providers.set('cloudflare', {
      id: 'cloudflare',
      name: 'Cloudflare AI Gateway',
      baseUrl: config.cfGatewayUrl,
      apiKey: config.cfGatewayAuthToken,
      enabled: !!config.cfGatewayUrl && !!config.cfGatewayAuthToken,
      healthStatus: 'unknown' as any,
      lastHealthCheck: new Date(0),
      responseTime: 0,
      errorRate: 0,
      fallbackPriority: 1,
      modelMap: {
        '@cf/meta/llama-2-7b-chat-fp16': '@cf/meta/llama-2-7b-chat-fp16',
        '@cf/mistral/mistral-7b-instruct-v0.1': '@cf/mistral/mistral-7b-instruct-v0.1',
        '@cf/meta/llama-2-7b-chat-fp32': '@cf/meta/llama-2-7b-chat-fp32',
        // Add more mappings as needed
      }
    });

    // OpenAI provider
    this.providers.set('openai', {
      id: 'openai',
      name: 'OpenAI API',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: config.originalEnv?.OPENAI_API_KEY || config.originalEnv?.OPENAI_TOKEN || '',
      enabled: !!config.originalEnv?.OPENAI_API_KEY || !!config.originalEnv?.OPENAI_TOKEN,
      healthStatus: 'unknown' as any,
      lastHealthCheck: new Date(0),
      responseTime: 0,
      errorRate: 0,
      fallbackPriority: 2,
      modelMap: {
        'gpt-4': 'gpt-4',
        'gpt-4-32k': 'gpt-4-32k',
        'gpt-3.5-turbo': 'gpt-3.5-turbo',
        'gpt-3.5-turbo-16k': 'gpt-3.5-turbo-16k',
        // Map Cloudflare models to closest OpenAI equivalents
        '@cf/meta/llama-2-7b-chat-fp16': 'gpt-3.5-turbo',
        '@cf/mistral/mistral-7b-instruct-v0.1': 'gpt-3.5-turbo'
      }
    });

    // Anthropic provider
    this.providers.set('anthropic', {
      id: 'anthropic',
      name: 'Anthropic API',
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: config.originalEnv?.ANTHROPIC_API_KEY || '',
      enabled: !!config.originalEnv?.ANTHROPIC_API_KEY,
      healthStatus: 'unknown' as any,
      lastHealthCheck: new Date(0),
      responseTime: 0,
      errorRate: 0,
      fallbackPriority: 3,
      modelMap: {
        'claude-3-opus': 'claude-3-opus',
        'claude-3-sonnet': 'claude-3-sonnet',
        'claude-3-haiku': 'claude-3-haiku',
        // Map Cloudflare models to closest Anthropic equivalents
        '@cf/meta/llama-2-7b-chat-fp16': 'claude-3-haiku',
        '@cf/mistral/mistral-7b-instruct-v0.1': 'claude-3-haiku'
      }
    });

    // Google provider
    this.providers.set('google', {
      id: 'google',
      name: 'Google AI API',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: config.originalEnv?.GOOGLE_API_KEY || '',
      enabled: !!config.originalEnv?.GOOGLE_API_KEY,
      healthStatus: 'unknown' as any,
      lastHealthCheck: new Date(0),
      responseTime: 0,
      errorRate: 0,
      fallbackPriority: 4,
      modelMap: {
        'gemini-pro': 'gemini-pro',
        'gemini-1.5-pro': 'gemini-1.5-pro',
        // Map Cloudflare models to closest Google equivalents
        '@cf/meta/llama-2-7b-chat-fp16': 'gemini-pro',
        '@cf/mistral/mistral-7b-instruct-v0.1': 'gemini-pro'
      }
    });

    // Initialize stats for each provider
    for (const providerId of this.providers.keys()) {
      this.providerStats.set(providerId, {
        successCount: 0,
        errorCount: 0,
        totalResponseTime: 0,
        requestCount: 0
      });
    }
  }

  private async startHealthChecks(): Promise<void> {
    // Perform initial health checks
    await this.performHealthChecks();
    
    // Set up periodic health checks
    setInterval(() => {
      this.performHealthChecks().catch(error => {
        console.error('Error during health check:', error);
      });
    }, this.config.healthCheckInterval);
  }

  private async performHealthChecks(): Promise<void> {
    const promises = Array.from(this.providers.values()).map(async (provider) => {
      if (!provider.enabled) {
        provider.healthStatus = 'unhealthy';
        return;
      }

      try {
        const startTime = Date.now();
        const response = await fetch(`${provider.baseUrl}/models`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${provider.apiKey}`,
            'Content-Type': 'application/json'
          },
          signal: AbortSignal.timeout(5000) // 5 second timeout
        });

        const responseTime = Date.now() - startTime;
        provider.responseTime = responseTime;

        const stats = this.providerStats.get(provider.id)!;
        if (response.ok) {
          provider.healthStatus = 'healthy';
          provider.lastHealthCheck = new Date();

          // Update stats
          stats.successCount++;
        } else {
          provider.healthStatus = 'unhealthy';
          stats.errorCount++;
        }
      } catch (error) {
        provider.healthStatus = 'unhealthy';
        const stats = this.providerStats.get(provider.id)!;
        stats.errorCount++;
      }
    });

    await Promise.all(promises);
  }

  /**
   * Select the best provider based on health status, performance, and load
   */
  private selectBestProvider(model: string): AIProviderConfig | null {
    // Get all enabled, healthy providers
    const healthyProviders = Array.from(this.providers.values())
      .filter(provider => provider.enabled && provider.healthStatus === 'healthy')
      .sort((a, b) => {
        // Sort by health status, then by response time, then by error rate
        // Priority 1: Health status (already filtered)
        // Priority 2: Response time (lower is better)
        // Priority 3: Error rate (lower is better)
        // Priority 4: Fallback priority (higher priority number is better)
        
        if (a.responseTime !== b.responseTime) {
          return a.responseTime - b.responseTime;
        }
        
        return a.errorRate - b.errorRate;
      });

    if (healthyProviders.length === 0) {
      return null;
    }

    // If we have the primary provider available, prefer it
    const primary = healthyProviders.find(p => p.id === this.config.primaryProvider);
    if (primary) {
      return primary;
    }

    // Otherwise, return the best performing provider
    return healthyProviders[0] ?? null;
  }

  /**
   * Transform the request for a specific provider
   */
  private transformRequestForProvider(request: AIRequest, provider: AIProviderConfig, actualModel: string): any {
    switch (provider.id) {
      case 'openai':
        return {
          model: actualModel,
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.max_tokens,
          top_p: request.top_p,
          frequency_penalty: request.frequency_penalty,
          presence_penalty: request.presence_penalty,
          stop: request.stop
        };
      
      case 'anthropic':
        // Anthropic uses a different format
        return {
          model: actualModel,
          messages: request.messages,
          system: request.messages.find(m => m.role === 'system')?.content || '',
          max_tokens: request.max_tokens || 1024,
          temperature: request.temperature,
          top_p: request.top_p,
          stop_sequences: request.stop
        };
      
      case 'google':
        // Google uses a different format
        return {
          contents: request.messages.map(msg => ({
            role: msg.role === 'assistant' ? 'model' : msg.role,
            parts: [{
              text: msg.content
            }]
          })),
          generationConfig: {
            temperature: request.temperature,
            maxOutputTokens: request.max_tokens,
            topP: request.top_p,
            stopSequences: request.stop
          }
        };
      
      case 'cloudflare':
      default:
        return {
          model: actualModel,
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.max_tokens,
          top_p: request.top_p,
          frequency_penalty: request.frequency_penalty,
          presence_penalty: request.presence_penalty,
          stop: request.stop
        };
    }
  }

  /**
   * Transform the response from a specific provider to standard format
   */
  private transformResponseFromProvider(response: any, provider: AIProviderConfig): AIResponse {
    switch (provider.id) {
      case 'anthropic':
        // Anthropic returns different format
        return {
          id: response.id || 'anthropic-response',
          object: 'chat.completion',
          created: response.created || Math.floor(Date.now() / 1000),
          model: response.model || provider.id,
          choices: response.content?.map((content: any, index: number) => ({
            index,
            message: { role: 'assistant', content: content.text || content.text || '' },
            finish_reason: response.stop_reason || 'stop'
          })) || [],
          usage: response.usage || undefined
        };
      
      case 'google':
        // Google returns different format
        return {
          id: response.responseId || 'google-response',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: response.model || provider.id,
          choices: response.candidates?.map((candidate: any, index: number) => ({
            index,
            message: { 
              role: 'assistant', 
              content: candidate.content.parts?.map((part: any) => part.text).join('') || '' 
            },
            finish_reason: candidate.finishReason || 'STOP'
          })) || [],
          usage: response.usageMetadata ? {
            prompt_tokens: response.usageMetadata.promptTokenCount || 0,
            completion_tokens: response.usageMetadata.candidatesTokenCount || 0,
            total_tokens: response.usageMetadata.totalTokenCount || 0
          } : undefined
        };
      
      case 'openai':
      case 'cloudflare':
      default:
        // OpenAI and Cloudflare formats are similar
        return response;
    }
  }

  /**
   * Make a request to a specific provider
   */
  private async requestProvider(provider: AIProviderConfig, request: AIRequest): Promise<AIResponse> {
    // Map the requested model to the provider's equivalent
    const modelMap = provider.modelMap;
    let actualModel = modelMap[request.model] || request.model;
    
    // Transform the request for the specific provider
    const transformedRequest = this.transformRequestForProvider(request, provider, actualModel);
    
    // Prepare headers based on provider
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    
    if (provider.id === 'anthropic') {
      headers['x-api-key'] = provider.apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else if (provider.id === 'google') {
      headers['x-goog-api-key'] = provider.apiKey;
    } else {
      headers['Authorization'] = `Bearer ${provider.apiKey}`;
      if (provider.id === 'cloudflare') {
        headers['cf-aig-authorization'] = `Bearer ${provider.apiKey}`;
      }
    }
    
    const startTime = Date.now();
    let response: Response;
    
    try {
      // Make the API request
      response = await fetch(
        provider.id === 'google' 
          ? `${provider.baseUrl}/models/${actualModel}:generateContent` 
          : `${provider.baseUrl}/chat/completions`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(transformedRequest),
          signal: AbortSignal.timeout(this.config.timeout) // Use configured timeout
        }
      );
      
      if (!response.ok) {
        throw new Error(`Provider ${provider.id} returned status ${response.status}: ${await response.text()}`);
      }
      
      const responseData = await response.json();
      const responseTime = Date.now() - startTime;
      
      // Update provider stats
      const stats = this.providerStats.get(provider.id)!;
      stats.successCount++;
      stats.totalResponseTime += responseTime;
      stats.requestCount++;
      
      // Log successful request
      const requestId = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
      this.requestHistory.push({
        id: requestId,
        provider: provider.id,
        success: true,
        timestamp: new Date(),
        responseTime
      });
      
      // Return transformed response
      return this.transformResponseFromProvider(responseData, provider);
    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      // Update provider stats for error
      const stats = this.providerStats.get(provider.id)!;
      stats.errorCount++;
      stats.totalResponseTime += responseTime;
      stats.requestCount++;
      
      // Log failed request
      const requestId = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
      this.requestHistory.push({
        id: requestId,
        provider: provider.id,
        success: false,
        timestamp: new Date(),
        responseTime
      });
      
      throw error;
    }
  }

  /**
   * Make an AI request with fallback mechanisms
   */
  async requestModel(model: string, inputs: any): Promise<AIResponse> {
    // Validate input using AI guardrails
    const validation = await this.aiGuardrails.validateInput(JSON.stringify(inputs));
    if (!validation.allowed) {
      throw new Error(`Request validation failed: ${validation.reason}`);
    }
    
    // Convert inputs to our standard request format
    const request: AIRequest = {
      model,
      messages: inputs.messages || [{ role: 'user', content: inputs.prompt || inputs.input || '' }],
      temperature: inputs.temperature,
      max_tokens: inputs.max_tokens,
      top_p: inputs.top_p,
      frequency_penalty: inputs.frequency_penalty,
      presence_penalty: inputs.presence_penalty,
      stop: inputs.stop
    };
    
    // Get the primary provider
    let provider = this.selectBestProvider(model);
    
    if (!provider) {
      throw new Error('No available AI providers. All providers are unhealthy.');
    }
    
    // Attempt the request with fallbacks
    let lastError: Error | null = null;
    let providersTried = 0;
    const maxTries = Math.min(this.config.maxRetries, this.providers.size);
    
    while (providersTried < maxTries) {
      try {
        console.log(`Attempting request with provider: ${provider.id} (try ${providersTried + 1}/${maxTries})`);
        
        const result = await this.requestProvider(provider, request);
        
        // Success! Return the result
        return result;
      } catch (error) {
        console.error(`Provider ${provider.id} failed:`, error);
        lastError = error as Error;
        
        // Mark this provider as unhealthy
        provider.healthStatus = 'unhealthy';
        
        // Select the next best provider
        providersTried++;
        provider = this.selectBestProvider(model);
        
        if (!provider) {
          break; // No more providers available
        }
        
        // Small delay before trying next provider
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    // If we get here, all providers failed
    throw new Error(`All AI providers failed after ${providersTried} attempts. Last error: ${lastError?.message || 'Unknown error'}`);
  }

  /**
   * Get list of available models across all providers
   */
  async listModels(): Promise<any> {
    const allModels: Array<{ provider: string; id: string; name: string; capabilities: string[] }> = [];
    
    for (const [providerId, provider] of this.providers.entries()) {
      if (provider.enabled && provider.healthStatus === 'healthy') {
        try {
          const response = await fetch(`${provider.baseUrl}/models`, {
            headers: {
              'Authorization': `Bearer ${provider.apiKey}`,
              'Content-Type': 'application/json'
            }
          });
          
          if (response.ok) {
            const data = await response.json() as any;

            if (data.data && Array.isArray(data.data)) {
              // OpenAI/Cloudflare format
              for (const model of data.data) {
                allModels.push({
                  provider: providerId,
                  id: model.id,
                  name: model.id,
                  capabilities: model.capabilities || []
                });
              }
            } else if (data.models && Array.isArray(data.models)) {
              // Anthropic format
              for (const model of data.models) {
                allModels.push({
                  provider: providerId,
                  id: model.model,
                  name: model.model,
                  capabilities: model.capabilities || []
                });
              }
            } else {
              // Generic format - add the provider's model mappings
              for (const [cfModel, mappedModel] of Object.entries(provider.modelMap)) {
                allModels.push({
                  provider: providerId,
                  id: mappedModel,
                  name: mappedModel,
                  capabilities: ['text-generation']
                });
              }
            }
          }
        } catch (error) {
          console.error(`Error fetching models from ${providerId}:`, error);
        }
      }
    }
    
    return { models: allModels };
  }

  /**
   * Get provider statistics and health information
   */
  getProviderStats(): any {
    const providerInfo = Array.from(this.providers.values()).map(provider => {
      const stats = this.providerStats.get(provider.id)!;
      const avgResponseTime = stats.requestCount > 0 
        ? stats.totalResponseTime / stats.requestCount 
        : 0;
      const successRate = stats.requestCount > 0 
        ? stats.successCount / stats.requestCount 
        : 0;
      
      return {
        id: provider.id,
        name: provider.name,
        healthStatus: provider.healthStatus,
        enabled: provider.enabled,
        responseTime: provider.responseTime,
        avgResponseTime,
        successRate,
        totalRequests: stats.requestCount,
        errors: stats.errorCount
      };
    });
    
    return {
      timestamp: new Date(),
      providers: providerInfo,
      totalRequests: this.requestHistory.length,
      recentRequests: this.requestHistory.slice(-10) // Last 10 requests
    };
  }

  async testConnection(): Promise<boolean> {
    try {
      // Test the primary provider first
      const primary = this.providers.get(this.config.primaryProvider);
      if (primary && primary.enabled && primary.healthStatus === 'healthy') {
        return true;
      }
      
      // If primary is not available, test any healthy provider
      for (const provider of this.providers.values()) {
        if (provider.enabled && provider.healthStatus === 'healthy') {
          return true;
        }
      }
      
      return false;
    } catch (error) {
      console.error('AI Gateway connection test failed:', error);
      return false;
    }
  }
}

// Initialize Enhanced AI Gateway middleware
export const initializeEnhancedAIGateway = async (c: Context, next: () => Promise<void>) => {
  const configService = c.get('configService');
  const aiGuardrailsService = c.get('aiGuardrailsService');
  
  if (!configService || !aiGuardrailsService) {
    console.error('Config service or AI guardrails service not initialized for enhanced AI Gateway');
    throw new Error('Required services not available for enhanced AI Gateway');
  }
  
  // Create fallback configuration
  const env = c.env || process.env;
  const fallbackConfig: AIFallbackConfig = {
    primaryProvider: env.AI_PRIMARY_PROVIDER || 'cloudflare',
    fallbackProviders: (env.AI_FALLBACK_PROVIDERS || 'openai,anthropic,google').split(','),
    maxRetries: parseInt(env.AI_MAX_FALLBACK_RETRIES || '3'),
    timeout: parseInt(env.AI_REQUEST_TIMEOUT || '30000'), // 30 seconds
    providerWeights: {}, // Will be calculated dynamically
    healthCheckInterval: parseInt(env.AI_HEALTH_CHECK_INTERVAL || '60000') // 1 minute
  };
  
  const enhancedAIGateway = new EnhancedAIGateway(fallbackConfig, aiGuardrailsService, configService);
  c.set('enhancedAIGateway', enhancedAIGateway);
  
  await next();
};