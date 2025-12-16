/**
 * Adaptability Service - Enables the system to integrate new features at runtime
 * Wires together: Extension System, Self-Learning, MCP Marketplace, Feature Requests
 */

import { storage } from '../shared/storage';
import { aiGateway } from '../shared/services';
import { config } from '../shared/config';

export interface FeatureRequest {
  id: string;
  description: string;
  requestedBy: string;
  status: 'pending' | 'analyzing' | 'implementing' | 'testing' | 'completed' | 'rejected';
  category: 'plugin' | 'agent' | 'service' | 'api' | 'integration' | 'config' | 'other';
  priority: 'low' | 'medium' | 'high' | 'critical';
  analysis?: FeatureAnalysis;
  implementation?: ImplementationPlan;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export interface FeatureAnalysis {
  feasibility: 'easy' | 'moderate' | 'complex' | 'requires_external';
  estimatedEffort: string;
  requiredComponents: string[];
  existingServices: string[];
  suggestedApproach: string;
  risks: string[];
  dependencies: string[];
}

export interface ImplementationPlan {
  steps: ImplementationStep[];
  estimatedTime: string;
  requiredPermissions: string[];
  rollbackPlan: string;
}

export interface ImplementationStep {
  order: number;
  description: string;
  type: 'create_file' | 'modify_file' | 'install_package' | 'configure' | 'deploy' | 'test';
  target?: string;
  content?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

export interface Extension {
  id: string;
  name: string;
  type: 'plugin' | 'agent' | 'service' | 'mcp';
  version: string;
  description: string;
  enabled: boolean;
  entryPoint: string;
  config?: Record<string, any>;
  installedAt: Date;
}

export interface RuntimeConfig {
  key: string;
  value: any;
  type: 'string' | 'number' | 'boolean' | 'json';
  description: string;
  editable: boolean;
  requiresRestart: boolean;
}

export interface LearningEntry {
  id: string;
  userRequest: string;
  systemResponse: string;
  outcome: 'success' | 'failure' | 'partial';
  feedback?: string;
  rating?: number;
  improvements?: string[];
  timestamp: Date;
}

/**
 * Adaptability Service - Main class for system adaptability
 */
export class AdaptabilityService {
  private featureRequests: Map<string, FeatureRequest> = new Map();
  private extensions: Map<string, Extension> = new Map();
  private runtimeConfig: Map<string, RuntimeConfig> = new Map();
  private learnings: LearningEntry[] = [];
  private initialized: boolean = false;

  constructor() {
    this.initializeDefaultConfig();
  }

  /**
   * Initialize the service and load persisted data
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Load feature requests from storage
      const savedRequests = await storage.get<FeatureRequest[]>('adaptability:requests');
      if (savedRequests) {
        savedRequests.forEach(r => this.featureRequests.set(r.id, r));
      }

      // Load extensions
      const savedExtensions = await storage.get<Extension[]>('adaptability:extensions');
      if (savedExtensions) {
        savedExtensions.forEach(e => this.extensions.set(e.id, e));
      }

      // Load learnings
      const savedLearnings = await storage.get<LearningEntry[]>('adaptability:learnings');
      if (savedLearnings) {
        this.learnings = savedLearnings;
      }

      this.initialized = true;
      console.log('[AdaptabilityService] Initialized with', {
        featureRequests: this.featureRequests.size,
        extensions: this.extensions.size,
        learnings: this.learnings.length
      });
    } catch (error) {
      console.error('[AdaptabilityService] Initialization error:', error);
    }
  }

  /**
   * Initialize default runtime configuration
   */
  private initializeDefaultConfig(): void {
    const defaults: RuntimeConfig[] = [
      { key: 'max_concurrent_tasks', value: 50, type: 'number', description: 'Maximum concurrent agent tasks', editable: true, requiresRestart: false },
      { key: 'task_timeout', value: 300000, type: 'number', description: 'Task timeout in milliseconds', editable: true, requiresRestart: false },
      { key: 'rate_limit_requests', value: 100, type: 'number', description: 'Rate limit requests per minute', editable: true, requiresRestart: false },
      { key: 'enable_learning', value: true, type: 'boolean', description: 'Enable self-learning features', editable: true, requiresRestart: false },
      { key: 'auto_approve_safe_features', value: false, type: 'boolean', description: 'Auto-approve low-risk features', editable: true, requiresRestart: false },
      { key: 'extension_sandbox', value: true, type: 'boolean', description: 'Run extensions in sandbox', editable: true, requiresRestart: true },
    ];

    defaults.forEach(c => this.runtimeConfig.set(c.key, c));
  }

  // ============================================================
  // FEATURE REQUEST HANDLING
  // ============================================================

  /**
   * Submit a new feature request
   */
  async submitFeatureRequest(description: string, requestedBy: string = 'user'): Promise<FeatureRequest> {
    const id = `feat-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    
    const request: FeatureRequest = {
      id,
      description,
      requestedBy,
      status: 'pending',
      category: 'other',
      priority: 'medium',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.featureRequests.set(id, request);
    await this.persistFeatureRequests();

    // Start async analysis
    this.analyzeFeatureRequest(id);

    return request;
  }

  /**
   * Analyze a feature request using AI
   */
  async analyzeFeatureRequest(requestId: string): Promise<FeatureAnalysis | null> {
    const request = this.featureRequests.get(requestId);
    if (!request) return null;

    request.status = 'analyzing';
    request.updatedAt = new Date();

    try {
      // Use AI to analyze the feature request
      const analysisPrompt = `Analyze this feature request for a multi-agent AI system:

Feature Request: "${request.description}"

The system has these existing capabilities:
- Agent orchestration (InfrastructureAgent, MonitoringAgent, KnowledgeAgent)
- Docker management
- Terraform infrastructure as code
- Redis storage
- Vector search (Qdrant)
- AI Gateway (Cloudflare)
- Security services (prompt injection protection)
- MCP marketplace (35+ servers)

Analyze and respond in JSON format:
{
  "category": "plugin|agent|service|api|integration|config|other",
  "feasibility": "easy|moderate|complex|requires_external",
  "estimatedEffort": "description of effort",
  "requiredComponents": ["list", "of", "components"],
  "existingServices": ["services", "that", "can", "be", "used"],
  "suggestedApproach": "how to implement this",
  "risks": ["potential", "risks"],
  "dependencies": ["what", "this", "depends", "on"],
  "priority": "low|medium|high|critical"
}`;

      const response = await aiGateway.chatCompletion([
        { role: 'system', content: 'You are an expert software architect analyzing feature requests. Respond only with valid JSON.' },
        { role: 'user', content: analysisPrompt }
      ], { temperature: 0.3 });

      const analysisText = response.choices[0]?.message?.content || '{}';
      
      // Parse JSON from response
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const analysis = JSON.parse(jsonMatch[0]);
        
        request.analysis = {
          feasibility: analysis.feasibility || 'moderate',
          estimatedEffort: analysis.estimatedEffort || 'Unknown',
          requiredComponents: analysis.requiredComponents || [],
          existingServices: analysis.existingServices || [],
          suggestedApproach: analysis.suggestedApproach || '',
          risks: analysis.risks || [],
          dependencies: analysis.dependencies || []
        };
        
        request.category = analysis.category || 'other';
        request.priority = analysis.priority || 'medium';
        request.status = 'pending'; // Ready for implementation decision
        request.updatedAt = new Date();
        
        await this.persistFeatureRequests();
        return request.analysis;
      }
    } catch (error) {
      console.error('[AdaptabilityService] Analysis error:', error);
      request.status = 'pending';
    }

    return null;
  }

  /**
   * Generate implementation plan for a feature
   */
  async generateImplementationPlan(requestId: string): Promise<ImplementationPlan | null> {
    const request = this.featureRequests.get(requestId);
    if (!request || !request.analysis) return null;

    try {
      const planPrompt = `Generate an implementation plan for this feature:

Feature: "${request.description}"
Category: ${request.category}
Feasibility: ${request.analysis.feasibility}
Suggested Approach: ${request.analysis.suggestedApproach}
Required Components: ${request.analysis.requiredComponents.join(', ')}

Generate a step-by-step implementation plan in JSON:
{
  "steps": [
    {
      "order": 1,
      "description": "step description",
      "type": "create_file|modify_file|install_package|configure|deploy|test",
      "target": "optional file/service path"
    }
  ],
  "estimatedTime": "time estimate",
  "requiredPermissions": ["list", "of", "permissions"],
  "rollbackPlan": "how to undo if something fails"
}`;

      const response = await aiGateway.chatCompletion([
        { role: 'system', content: 'You are an expert software engineer creating implementation plans. Respond only with valid JSON.' },
        { role: 'user', content: planPrompt }
      ], { temperature: 0.3 });

      const planText = response.choices[0]?.message?.content || '{}';
      const jsonMatch = planText.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const plan = JSON.parse(jsonMatch[0]);
        
        request.implementation = {
          steps: (plan.steps || []).map((s: any, i: number) => ({
            order: s.order || i + 1,
            description: s.description,
            type: s.type || 'configure',
            target: s.target,
            status: 'pending' as const
          })),
          estimatedTime: plan.estimatedTime || 'Unknown',
          requiredPermissions: plan.requiredPermissions || [],
          rollbackPlan: plan.rollbackPlan || 'Revert changes manually'
        };
        
        request.status = 'implementing';
        request.updatedAt = new Date();
        await this.persistFeatureRequests();
        
        return request.implementation;
      }
    } catch (error) {
      console.error('[AdaptabilityService] Plan generation error:', error);
    }

    return null;
  }

  /**
   * Get all feature requests
   */
  getFeatureRequests(status?: string): FeatureRequest[] {
    const requests = Array.from(this.featureRequests.values());
    if (status) {
      return requests.filter(r => r.status === status);
    }
    return requests.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Get a specific feature request
   */
  getFeatureRequest(id: string): FeatureRequest | undefined {
    return this.featureRequests.get(id);
  }

  /**
   * Update feature request status
   */
  async updateFeatureStatus(id: string, status: FeatureRequest['status']): Promise<boolean> {
    const request = this.featureRequests.get(id);
    if (!request) return false;

    request.status = status;
    request.updatedAt = new Date();
    if (status === 'completed') {
      request.completedAt = new Date();
    }
    
    await this.persistFeatureRequests();
    return true;
  }

  // ============================================================
  // EXTENSION MANAGEMENT
  // ============================================================

  /**
   * Register a new extension
   */
  async registerExtension(extension: Omit<Extension, 'id' | 'installedAt'>): Promise<Extension> {
    const id = `ext-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    
    const newExtension: Extension = {
      ...extension,
      id,
      installedAt: new Date()
    };

    this.extensions.set(id, newExtension);
    await this.persistExtensions();
    
    return newExtension;
  }

  /**
   * Get all extensions
   */
  getExtensions(type?: Extension['type']): Extension[] {
    const extensions = Array.from(this.extensions.values());
    if (type) {
      return extensions.filter(e => e.type === type);
    }
    return extensions;
  }

  /**
   * Enable/disable an extension
   */
  async toggleExtension(id: string, enabled: boolean): Promise<boolean> {
    const extension = this.extensions.get(id);
    if (!extension) return false;

    extension.enabled = enabled;
    await this.persistExtensions();
    return true;
  }

  /**
   * Remove an extension
   */
  async removeExtension(id: string): Promise<boolean> {
    const deleted = this.extensions.delete(id);
    if (deleted) {
      await this.persistExtensions();
    }
    return deleted;
  }

  // ============================================================
  // RUNTIME CONFIGURATION
  // ============================================================

  /**
   * Get runtime configuration
   */
  getRuntimeConfig(): RuntimeConfig[] {
    return Array.from(this.runtimeConfig.values());
  }

  /**
   * Get a specific config value
   */
  getConfigValue(key: string): any {
    return this.runtimeConfig.get(key)?.value;
  }

  /**
   * Update runtime configuration
   */
  async updateConfig(key: string, value: any): Promise<{ success: boolean; requiresRestart: boolean }> {
    const config = this.runtimeConfig.get(key);
    if (!config || !config.editable) {
      return { success: false, requiresRestart: false };
    }

    config.value = value;
    await storage.set('adaptability:config', Array.from(this.runtimeConfig.values()));
    
    return { success: true, requiresRestart: config.requiresRestart };
  }

  // ============================================================
  // LEARNING & FEEDBACK
  // ============================================================

  /**
   * Record a learning entry
   */
  async recordLearning(entry: Omit<LearningEntry, 'id' | 'timestamp'>): Promise<LearningEntry> {
    const learning: LearningEntry = {
      ...entry,
      id: `learn-${Date.now()}`,
      timestamp: new Date()
    };

    this.learnings.push(learning);
    
    // Keep last 1000 learnings
    if (this.learnings.length > 1000) {
      this.learnings = this.learnings.slice(-1000);
    }
    
    await storage.set('adaptability:learnings', this.learnings);
    return learning;
  }

  /**
   * Get learning statistics
   */
  getLearningStats(): {
    total: number;
    successRate: number;
    avgRating: number;
    recentTrend: 'improving' | 'stable' | 'declining';
  } {
    const total = this.learnings.length;
    if (total === 0) {
      return { total: 0, successRate: 0, avgRating: 0, recentTrend: 'stable' };
    }

    const successes = this.learnings.filter(l => l.outcome === 'success').length;
    const ratings = this.learnings.filter(l => l.rating !== undefined).map(l => l.rating!);
    const avgRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;

    // Calculate trend from last 100 vs previous 100
    const recent = this.learnings.slice(-100);
    const previous = this.learnings.slice(-200, -100);
    
    const recentSuccess = recent.filter(l => l.outcome === 'success').length / Math.max(recent.length, 1);
    const prevSuccess = previous.filter(l => l.outcome === 'success').length / Math.max(previous.length, 1);

    let recentTrend: 'improving' | 'stable' | 'declining' = 'stable';
    if (recentSuccess > prevSuccess + 0.05) recentTrend = 'improving';
    else if (recentSuccess < prevSuccess - 0.05) recentTrend = 'declining';

    return {
      total,
      successRate: successes / total,
      avgRating,
      recentTrend
    };
  }

  /**
   * Search learnings for similar past requests
   */
  searchSimilarRequests(query: string, limit: number = 5): LearningEntry[] {
    const queryLower = query.toLowerCase();
    const words = queryLower.split(/\s+/);
    
    return this.learnings
      .map(l => ({
        entry: l,
        score: words.filter(w => l.userRequest.toLowerCase().includes(w)).length
      }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(r => r.entry);
  }

  // ============================================================
  // CAPABILITIES DISCOVERY
  // ============================================================

  /**
   * Get current system capabilities
   */
  getCapabilities(): {
    agents: string[];
    services: string[];
    endpoints: string[];
    extensions: number;
    features: string[];
  } {
    return {
      agents: ['orchestrator', 'infrastructure', 'monitoring', 'knowledge'],
      services: [
        'AI Gateway', 'Vector Search', 'Redis Storage', 'PostgreSQL',
        'Docker Management', 'Terraform IaC', 'Security/Guardrails',
        'MCP Marketplace', 'Self-Learning', 'Extension System'
      ],
      endpoints: [
        '/api/tasks', '/api/agents', '/api/chat', '/api/knowledge',
        '/api/terraform', '/api/security', '/api/adaptability'
      ],
      extensions: this.extensions.size,
      features: [
        'Multi-agent orchestration',
        'Prompt injection protection',
        'Rate limiting',
        'Infrastructure as Code',
        'Knowledge base (RAG)',
        'Vector similarity search',
        'Dynamic feature requests',
        'Self-learning from feedback',
        'Runtime configuration'
      ]
    };
  }

  /**
   * Suggest features based on usage patterns
   */
  async suggestFeatures(): Promise<string[]> {
    const stats = this.getLearningStats();
    const capabilities = this.getCapabilities();
    
    const suggestions: string[] = [];

    // Suggest based on gaps
    if (!capabilities.services.includes('Kubernetes')) {
      suggestions.push('Add Kubernetes management capabilities');
    }
    
    if (stats.successRate < 0.8) {
      suggestions.push('Improve error handling and recovery');
    }

    if (this.extensions.size < 3) {
      suggestions.push('Explore MCP marketplace for additional integrations');
    }

    // Add AI-generated suggestions
    try {
      const response = await aiGateway.chatCompletion([
        { role: 'system', content: 'Suggest 3 useful features for an AI agent system. Be brief.' },
        { role: 'user', content: `Current capabilities: ${capabilities.services.join(', ')}` }
      ], { temperature: 0.7, maxTokens: 200 });
      
      const aiSuggestions = response.choices[0]?.message?.content;
      if (aiSuggestions) {
        suggestions.push(...aiSuggestions.split('\n').filter((s: string) => s.trim().length > 0).slice(0, 3));
      }
    } catch {
      // AI suggestions are optional
    }

    return suggestions.slice(0, 5);
  }

  // ============================================================
  // PERSISTENCE
  // ============================================================

  private async persistFeatureRequests(): Promise<void> {
    await storage.set('adaptability:requests', Array.from(this.featureRequests.values()));
  }

  private async persistExtensions(): Promise<void> {
    await storage.set('adaptability:extensions', Array.from(this.extensions.values()));
  }
}

// Export singleton
export const adaptabilityService = new AdaptabilityService();
