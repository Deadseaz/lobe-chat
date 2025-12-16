/**
 * Persistent Self-Evolving Learning Service
 * FULLY PERSISTENT - NO in-memory storage
 * Uses: D1, Vectorize, KV, Durable Objects, Cloudflare AI
 */

import { CloudflareEmbeddingsService } from './cloudflare-embeddings';
import { PersistentLearningStorage, StoredInteraction, StoredKnowledgeNode, StoredSkill, StoredAdaptationRule } from './persistent-learning-storage';

export interface LearningInteraction {
  sessionId: string;
  userId?: string;
  userInput: string;
  aiResponse: string;
  context?: any;
  feedbackScore?: number;
  executionResult?: {
    success: boolean;
    outcome: string;
    error?: string;
  };
  intent?: string;
  complexityScore?: number;
  responseQuality?: number;
  knowledgeTags?: string[];
}

export interface LearningMetrics {
  totalInteractions: number;
  totalLearnings: number;
  knowledgeBaseSize: number;
  skillCount: number;
  adaptationRulesCount: number;
  lastLearningCycle: string | null;
  performanceTrend: number;
  accuracyImprovement: number;
}

export class PersistentSelfLearningService {
  private storage: PersistentLearningStorage;
  private embeddings: CloudflareEmbeddingsService;
  private learningState: DurableObjectNamespace;
  private learningEnabled: boolean = true;

  constructor(
    storage: PersistentLearningStorage,
    embeddingsService: CloudflareEmbeddingsService,
    learningStateDO: DurableObjectNamespace
  ) {
    this.storage = storage;
    this.embeddings = embeddingsService;
    this.learningState = learningStateDO;
  }

  /**
   * Store a learning interaction
   */
  async storeInteraction(interaction: LearningInteraction): Promise<void> {
    if (!this.learningEnabled) return;

    const storedInteraction: StoredInteraction = {
      id: crypto.randomUUID(),
      sessionId: interaction.sessionId,
      userId: interaction.userId,
      userInput: interaction.userInput,
      aiResponse: interaction.aiResponse,
      context: interaction.context,
      timestamp: new Date().toISOString(),
      feedbackScore: interaction.feedbackScore,
      executionSuccess: interaction.executionResult?.success,
      executionOutcome: interaction.executionResult?.outcome,
      executionError: interaction.executionResult?.error,
      intent: interaction.intent,
      complexityScore: interaction.complexityScore,
      responseQuality: interaction.responseQuality,
      knowledgeTags: interaction.knowledgeTags
    };

    // Store in persistent storage
    await this.storage.storeInteraction(storedInteraction);

    // Add to knowledge base if valuable
    if (this.isValuableKnowledge(storedInteraction)) {
      await this.addToKnowledgeBase(storedInteraction);
    }

    // Update skill usage if applicable
    if (storedInteraction.executionSuccess) {
      await this.updateSkillUsage(storedInteraction);
    }
  }

  /**
   * Perform a complete learning cycle
   */
  async performLearningCycle(): Promise<void> {
    console.log('Starting persistent learning cycle...');

    // Get recent interactions
    const interactions = await this.storage.getInteractions(1000);

    if (interactions.length < 10) {
      console.log('Not enough interactions for learning cycle');
      return;
    }

    // Analyze interactions and identify patterns
    await this.analyzeAndStorePatterns(interactions);

    // Refine skills based on usage
    await this.refineSkills();

    // Generate adaptation rules from patterns
    await this.generateAdaptationRules();

    // Clean up old knowledge
    await this.cleanKnowledgeBase();

    // Update metrics in Durable Object
    await this.updateMetrics();

    console.log('Persistent learning cycle completed');
  }

  /**
   * Analyze interactions and store patterns
   */
  private async analyzeAndStorePatterns(interactions: StoredInteraction[]): Promise<void> {
    // Find common patterns
    const patternMap: Map<string, { count: number; successes: number; failures: number; examples: string[] }> = new Map();

    for (const interaction of interactions) {
      const phrases = this.extractCommonPhrases(interaction.userInput);

      for (const phrase of phrases) {
        if (!patternMap.has(phrase)) {
          patternMap.set(phrase, { count: 0, successes: 0, failures: 0, examples: [] });
        }

        const data = patternMap.get(phrase)!;
        data.count++;

        if (interaction.executionSuccess) {
          data.successes++;
        } else if (interaction.executionSuccess === false) {
          data.failures++;
        }

        if (data.examples.length < 3) {
          data.examples.push(interaction.userInput);
        }
      }
    }

    // Store patterns in database
    for (const [pattern, data] of patternMap.entries()) {
      if (data.count >= 3) { // Only store patterns that appear at least 3 times
        let patternType: 'common' | 'success' | 'failure' = 'common';

        const successRate = data.count > 0 ? data.successes / data.count : 0;
        const failureRate = data.count > 0 ? data.failures / data.count : 0;

        if (successRate > 0.7) {
          patternType = 'success';
        } else if (failureRate > 0.7) {
          patternType = 'failure';
        }

        await this.storage.storePattern({
          pattern,
          patternType,
          count: data.count,
          successCount: data.successes,
          failureCount: data.failures,
          examples: data.examples,
          lastUpdated: new Date().toISOString()
        });

        // Create skills or rules based on pattern type
        if (patternType === 'success' && data.successes >= 5) {
          await this.createSkillFromPattern(pattern, successRate, data.successes);
        } else if (patternType === 'failure' && data.failures >= 3) {
          await this.createAdaptationRuleForPattern(pattern, failureRate);
        }
      }
    }
  }

  /**
   * Create a skill from a successful pattern
   */
  private async createSkillFromPattern(pattern: string, successRate: number, usageCount: number): Promise<void> {
    const skillId = `auto-skill-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const skill: StoredSkill = {
      id: skillId,
      name: `Auto: ${pattern.substring(0, 50)}`,
      description: `Automatically learned skill from pattern: ${pattern}`,
      category: 'auto-generated',
      parameters: { pattern },
      successRate,
      usageCount,
      createdAt: new Date().toISOString(),
      examples: [],
      dependencies: []
    };

    await this.storage.storeSkill(skill);
    console.log(`Created auto-learned skill: ${skill.name}`);
  }

  /**
   * Create an adaptation rule for a failure pattern
   */
  private async createAdaptationRuleForPattern(pattern: string, failureRate: number): Promise<void> {
    const ruleId = `auto-rule-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const rule: StoredAdaptationRule = {
      id: ruleId,
      condition: `Input contains pattern "${pattern}" with high failure rate`,
      action: 'Handle with extra care, request clarification, or delegate to human',
      priority: Math.floor(failureRate * 10),
      enabled: true,
      matches: 0,
      positiveOutcomes: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await this.storage.storeAdaptationRule(rule);
    console.log(`Created adaptation rule for problematic pattern: ${pattern}`);
  }

  /**
   * Check if interaction contains valuable knowledge
   */
  private isValuableKnowledge(interaction: StoredInteraction): boolean {
    // Positive feedback
    if (interaction.feedbackScore && interaction.feedbackScore > 0.5) {
      return true;
    }

    // Successful complex task
    if (interaction.executionSuccess && interaction.complexityScore && interaction.complexityScore > 0.7) {
      return true;
    }

    return false;
  }

  /**
   * Add valuable interaction to knowledge base
   */
  private async addToKnowledgeBase(interaction: StoredInteraction): Promise<void> {
    const content = interaction.executionOutcome || interaction.aiResponse;
    const nodeId = `kb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const vectorizeId = `knowledge-${nodeId}`;

    // Find similar knowledge to create relationships
    const similarNodes = await this.storage.searchKnowledgeByEmbedding(content, 5);
    const relationships = similarNodes.map(n => n.id);

    const knowledgeNode: StoredKnowledgeNode = {
      id: nodeId,
      content,
      vectorizeId,
      context: {
        userInput: interaction.userInput,
        aiResponse: interaction.aiResponse,
        sessionId: interaction.sessionId,
        executionSuccess: interaction.executionSuccess
      },
      source: 'interaction',
      tags: await this.extractTagsFromContent(content),
      relationships,
      timestamp: new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
      accessCount: 0,
      relevanceScore: interaction.feedbackScore || 0.5
    };

    await this.storage.storeKnowledgeNode(knowledgeNode);
    console.log(`Added knowledge node: ${nodeId}`);
  }

  /**
   * Update skill usage statistics
   */
  private async updateSkillUsage(interaction: StoredInteraction): Promise<void> {
    const skills = await this.storage.getAllSkills();

    for (const skill of skills) {
      const userInputLower = interaction.userInput.toLowerCase();
      const aiResponseLower = interaction.aiResponse.toLowerCase();

      if (userInputLower.includes(skill.name.toLowerCase()) ||
          aiResponseLower.includes(skill.name.toLowerCase()) ||
          userInputLower.includes(skill.category.toLowerCase())) {
        await this.storage.updateSkillUsage(skill.id, interaction.executionSuccess || false);
      }
    }
  }

  /**
   * Refine skills based on usage patterns
   */
  private async refineSkills(): Promise<void> {
    const skills = await this.storage.getAllSkills();

    for (const skill of skills) {
      if (skill.usageCount > 10 && skill.successRate < 0.7) {
        console.log(`Skill "${skill.name}" needs refinement: low success rate (${skill.successRate}) with high usage (${skill.usageCount})`);
        // In a real system, you might adjust skill parameters or flag for review
      }

      if (skill.usageCount > 50 && skill.successRate > 0.9) {
        console.log(`Skill "${skill.name}" is highly effective: success rate ${skill.successRate}, usage ${skill.usageCount}`);
      }
    }
  }

  /**
   * Generate adaptation rules from patterns
   */
  private async generateAdaptationRules(): Promise<void> {
    const failurePatterns = await this.storage.getPatterns('failure', 50);

    for (const pattern of failurePatterns) {
      if (pattern.failureRate > 0.7 && pattern.failureCount >= 3) {
        // Rule likely already created, but check and update if needed
        console.log(`High-failure pattern detected: ${pattern.pattern} (${pattern.failureRate * 100}% failure rate)`);
      }
    }
  }

  /**
   * Clean up old knowledge
   */
  private async cleanKnowledgeBase(): Promise<void> {
    const retentionDays = 30; // Default retention
    const cutoffDate = new Date(Date.now() - (retentionDays * 24 * 60 * 60 * 1000)).toISOString();

    const deleted = await this.storage.deleteOldKnowledge(cutoffDate, 2);
    console.log(`Cleaned up ${deleted} old knowledge nodes`);
  }

  /**
   * Update metrics in Durable Object
   */
  private async updateMetrics(): Promise<void> {
    const interactions = await this.storage.getInteractions(1);
    const knowledge = await this.storage.getAllKnowledge(1);
    const skills = await this.storage.getAllSkills();
    const rules = await this.storage.getEnabledRules();

    // Get Durable Object stub
    const id = this.learningState.idFromName('global');
    const stub = this.learningState.get(id);

    await stub.fetch(new Request('http://do/update-metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        totalInteractions: interactions.length,
        knowledgeBaseSize: knowledge.length,
        skillCount: skills.length,
        adaptationRulesCount: rules.length,
        lastLearningCycle: new Date().toISOString()
      })
    }));
  }

  /**
   * Extract common phrases from text
   */
  private extractCommonPhrases(text: string): string[] {
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3);

    // Get unique words
    return Array.from(new Set(words)).slice(0, 5);
  }

  /**
   * Extract tags from content
   */
  private async extractTagsFromContent(content: string): Promise<string[]> {
    const tags: string[] = [];
    const lowerContent = content.toLowerCase();

    const tagPatterns: Record<string, string[]> = {
      'cloudflare': ['cloudflare', 'worker', 'zone', 'dns'],
      'docker': ['docker', 'container', 'image', 'deployment'],
      'ai': ['ai', 'model', 'llm', 'inference'],
      'security': ['security', 'auth', 'protect', 'trust'],
      'database': ['database', 'd1', 'sql', 'query'],
      'api': ['api', 'endpoint', 'rest', 'graphql']
    };

    for (const [tag, keywords] of Object.entries(tagPatterns)) {
      if (keywords.some(kw => lowerContent.includes(kw))) {
        tags.push(tag);
      }
    }

    return tags;
  }

  /**
   * Search knowledge base
   */
  async searchKnowledge(query: string, topK: number = 5): Promise<StoredKnowledgeNode[]> {
    return await this.storage.searchKnowledgeByEmbedding(query, topK);
  }

  /**
   * Get relevant skills for a task
   */
  async getRelevantSkills(taskDescription: string): Promise<StoredSkill[]> {
    const allSkills = await this.storage.getAllSkills();
    const taskLower = taskDescription.toLowerCase();

    return allSkills.filter(skill => {
      return taskLower.includes(skill.name.toLowerCase()) ||
             taskLower.includes(skill.category.toLowerCase());
    }).sort((a, b) => b.successRate - a.successRate);
  }

  /**
   * Apply adaptation rules
   */
  async applyAdaptationRules(context: any): Promise<string[]> {
    const rules = await this.storage.getEnabledRules();
    const applicableActions: string[] = [];

    for (const rule of rules) {
      // Simple pattern matching - in production you'd have more sophisticated logic
      if (this.evaluateRuleCondition(rule.condition, context)) {
        applicableActions.push(rule.action);
        await this.storage.updateRuleMatch(rule.id, true);
      }
    }

    return applicableActions;
  }

  /**
   * Evaluate rule condition
   */
  private evaluateRuleCondition(condition: string, context: any): boolean {
    // Simple implementation - check if condition keywords appear in context
    const conditionLower = condition.toLowerCase();
    const contextStr = JSON.stringify(context).toLowerCase();

    return conditionLower.split(' ').some(word => contextStr.includes(word));
  }

  /**
   * Get learning metrics
   */
  async getLearningMetrics(): Promise<LearningMetrics> {
    // Get from Durable Object
    const id = this.learningState.idFromName('global');
    const stub = this.learningState.get(id);

    const response = await stub.fetch(new Request('http://do/metrics'));
    const metrics = await response.json();

    return {
      totalInteractions: metrics.totalInteractions || 0,
      totalLearnings: metrics.totalLearnings || 0,
      knowledgeBaseSize: metrics.knowledgeBaseSize || 0,
      skillCount: metrics.skillCount || 0,
      adaptationRulesCount: metrics.adaptationRulesCount || 0,
      lastLearningCycle: metrics.lastUpdated || null,
      performanceTrend: metrics.performanceTrend || 0,
      accuracyImprovement: metrics.accuracyImprovement || 0
    };
  }

  /**
   * Enable/disable learning
   */
  setLearningEnabled(enabled: boolean): void {
    this.learningEnabled = enabled;
  }

  /**
   * Start automated learning cycles
   */
  async startLearningCycles(intervalMs: number = 300000): Promise<void> {
    const id = this.learningState.idFromName('global');
    const stub = this.learningState.get(id);

    await stub.fetch(new Request('http://do/start-learning', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cycleInterval: intervalMs })
    }));
  }

  /**
   * Stop automated learning cycles
   */
  async stopLearningCycles(): Promise<void> {
    const id = this.learningState.idFromName('global');
    const stub = this.learningState.get(id);

    await stub.fetch(new Request('http://do/stop-learning', {
      method: 'POST'
    }));
  }
}
