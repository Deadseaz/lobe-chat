/**
 * Advanced Self-Evolving Learning Algorithms for zagent
 * Implements sophisticated learning, adaptation, and knowledge retention mechanisms
 */

import { Context } from 'hono';
import { ConfigService } from '../shared/config.js';
import { RAGService } from '../shared/services.js';
import { VectorService } from '../shared/services.js';

export interface LearningInteraction {
  id: string;
  sessionId: string;
  userId?: string;
  userInput: string;
  aiResponse: string;
  context: any;
  timestamp: Date;
  feedbackScore?: number; // -1 to 1 scale, where negative is bad
  executionResult?: {
    success: boolean;
    outcome: string;
    error?: string;
  };
  embeddings?: number[]; // Vector embeddings for similarity matching
  intent?: string; // Classification of user intent
  complexityScore?: number; // How complex was the request
  responseQuality?: number; // Quality of AI response
  knowledgeTags?: string[]; // Tags for knowledge organization
}

export interface LearningModel {
  id: string;
  name: string;
  description: string;
  type: 'classification' | 'clustering' | 'regression' | 'neural';
  parameters: Record<string, any>;
  trainedAt: Date;
  performanceMetrics: {
    accuracy: number;
    precision: number;
    recall: number;
    f1Score: number;
    loss: number;
  };
  isActive: boolean;
}

export interface KnowledgeNode {
  id: string;
  content: string;
  embeddings: number[];
  context: any;
  source: string;
  tags: string[];
  relationships: string[]; // IDs of related nodes
  timestamp: Date;
  lastAccessed: Date;
  accessCount: number;
  relevanceScore: number;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
  parameters: Record<string, any>;
  successRate: number;
  usageCount: number;
  lastUsed: Date;
  createdAt: Date;
  examples: string[]; // Example uses
  dependencies: string[]; // Other skills this skill depends on
}

export interface AdaptationRule {
  id: string;
  condition: string; // Natural language condition
  action: string; // What to do when condition is met
  priority: number;
  enabled: boolean;
  matches: number; // How many times rule matched
  positiveOutcomes: number; // How many positive outcomes
  createdAt: Date;
  updatedAt: Date;
}

export interface LearningMetrics {
  totalInteractions: number;
  totalLearnings: number;
  knowledgeBaseSize: number;
  skillCount: number;
  adaptationRules: number;
  lastLearningCycle: Date;
  performanceTrend: number; // Improvement over time
  accuracyImprovement: number;
}

export class AdvancedSelfEvolvingService {
  private interactions: LearningInteraction[] = [];
  private knowledgeBase: Map<string, KnowledgeNode> = new Map();
  private skills: Map<string, Skill> = new Map();
  private adaptationRules: Map<string, AdaptationRule> = new Map();
  private learningModels: Map<string, LearningModel> = new Map();
  private configService: ConfigService;
  private ragService: RAGService;
  private vectorService: VectorService;
  private learningEnabled: boolean = true;
  private autoLearningInterval: number;
  private knowledgeRetentionDays: number;
  private maxKnowledgeNodes: number;

  constructor(
    configService: ConfigService, 
    ragService: RAGService, 
    vectorService: VectorService
  ) {
    this.configService = configService;
    this.ragService = ragService;
    this.vectorService = vectorService;
    
    const config = this.configService.getConfig();
    this.autoLearningInterval = parseInt(config.originalEnv?.SELF_LEARNING_INTERVAL || '300000'); // 5 minutes
    this.knowledgeRetentionDays = parseInt(config.originalEnv?.KNOWLEDGE_RETENTION_DAYS || '30'); // 30 days
    this.maxKnowledgeNodes = parseInt(config.originalEnv?.MAX_KNOWLEDGE_NODES || '10000'); // 10k nodes max
    
    // Initialize with basic skills
    this.initializeBasicSkills();
    
    // Start periodic learning cycles
    this.startPeriodicLearning();
  }

  private initializeBasicSkills(): void {
    // Add some basic operational skills
    this.skills.set('cloudflare-zone-management', {
      id: 'cloudflare-zone-management',
      name: 'Cloudflare Zone Management',
      description: 'Manage Cloudflare DNS zones',
      category: 'infrastructure',
      parameters: { zoneId: 'string', action: 'string' },
      successRate: 0.95,
      usageCount: 0,
      lastUsed: new Date(0),
      createdAt: new Date(),
      examples: [
        'Add a new DNS record to zone X',
        'Update DNS settings for domain Y'
      ],
      dependencies: []
    });

    this.skills.set('docker-deployment', {
      id: 'docker-deployment',
      name: 'Docker Deployment',
      description: 'Deploy and manage Docker containers',
      category: 'operations',
      parameters: { image: 'string', config: 'object' },
      successRate: 0.90,
      usageCount: 0,
      lastUsed: new Date(0),
      createdAt: new Date(),
      examples: [
        'Deploy container X with environment Y',
        'Scale service Z to N instances'
      ],
      dependencies: ['docker-hub-integration']
    });

    this.skills.set('ai-response-optimization', {
      id: 'ai-response-optimization',
      name: 'AI Response Optimization',
      description: 'Optimize AI responses based on context',
      category: 'ai',
      parameters: { context: 'object', query: 'string' },
      successRate: 0.98,
      usageCount: 0,
      lastUsed: new Date(0),
      createdAt: new Date(),
      examples: [
        'Provide more detailed answer to technical questions',
        'Simplify response for non-technical users'
      ],
      dependencies: []
    });
  }

  private startPeriodicLearning(): void {
    // Perform initial learning cycle
    this.performLearningCycle().catch(console.error);
    
    // Set up periodic learning
    setInterval(() => {
      this.performLearningCycle().catch(console.error);
    }, this.autoLearningInterval);
  }

  /**
   * Store a learning interaction for future analysis
   */
  async storeInteraction(interaction: Omit<LearningInteraction, 'id' | 'timestamp' | 'embeddings'>): Promise<void> {
    if (!this.learningEnabled) return;
    
    // Generate embeddings for the interaction
    const content = `${interaction.userInput} ${interaction.aiResponse}`;
    const embeddings = await this.generateEmbeddings(content);
    
    const learningInteraction: LearningInteraction = {
      ...interaction,
      id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      timestamp: new Date(),
      embeddings
    };
    
    this.interactions.push(learningInteraction);
    
    // Add to knowledge base if it contains valuable information
    if (this.isValuableKnowledge(learningInteraction)) {
      await this.addToKnowledgeBase(learningInteraction);
    }
    
    // Update skill usage if applicable
    if (interaction.executionResult?.success) {
      await this.updateSkillUsage(interaction);
    }
  }

  /**
   * Perform a complete learning cycle
   */
  async performLearningCycle(): Promise<void> {
    console.log('Starting learning cycle...');
    
    // Analyze recent interactions to identify patterns
    await this.analyzeInteractions();
    
    // Update knowledge base with new insights
    await this.updateKnowledgeBase();
    
    // Refine and create new skills
    await this.refineSkills();
    
    // Identify and create adaptation rules
    await this.generateAdaptationRules();
    
    // Clean up old/unused knowledge
    await this.cleanKnowledgeBase();
    
    // Update performance metrics
    await this.updatePerformanceMetrics();
    
    console.log('Learning cycle completed');
  }

  /**
   * Analyze recent interactions to identify patterns and improvements
   */
  private async analyzeInteractions(): Promise<void> {
    // Look for common patterns in user requests
    const commonPatterns = this.findCommonPatterns();
    
    // Look for successful interaction patterns
    const successfulPatterns = this.findSuccessfulPatterns();
    
    // Look for failure patterns to avoid in future
    const failurePatterns = this.findFailurePatterns();
    
    // Update internal models based on patterns
    await this.updateModelsFromPatterns(commonPatterns, successfulPatterns, failurePatterns);
  }

  /**
   * Find common patterns in interactions
   */
  private findCommonPatterns(): Array<{ pattern: string; count: number; examples: string[] }> {
    const patternMap: Map<string, { count: number; examples: string[] }> = new Map();
    
    // Simple pattern matching based on common phrases
    for (const interaction of this.interactions) {
      // Extract common phrases/requests
      const phrases = this.extractCommonPhrases(interaction.userInput);
      
      for (const phrase of phrases) {
        if (patternMap.has(phrase)) {
          const existing = patternMap.get(phrase)!;
          existing.count++;
          if (existing.examples.length < 3) { // Keep max 3 examples
            existing.examples.push(interaction.userInput);
          }
        } else {
          patternMap.set(phrase, { count: 1, examples: [interaction.userInput] });
        }
      }
    }
    
    // Convert to sorted array
    return Array.from(patternMap.entries())
      .map(([pattern, data]) => ({ pattern, ...data }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Find patterns that lead to successful outcomes
   */
  private findSuccessfulPatterns(): Array<{ pattern: string; successCount: number; successRate: number }> {
    const patternSuccessMap: Map<string, { successCount: number; total: number }> = new Map();
    
    for (const interaction of this.interactions) {
      if (interaction.feedbackScore && interaction.feedbackScore > 0.5) { // Positive feedback
        const phrases = this.extractCommonPhrases(interaction.userInput);
        
        for (const phrase of phrases) {
          if (patternSuccessMap.has(phrase)) {
            const existing = patternSuccessMap.get(phrase)!;
            existing.successCount++;
            existing.total++;
          } else {
            patternSuccessMap.set(phrase, { successCount: 1, total: 1 });
          }
        }
      } else if (interaction.executionResult?.success) {
        const phrases = this.extractCommonPhrases(interaction.userInput);
        
        for (const phrase of phrases) {
          if (patternSuccessMap.has(phrase)) {
            const existing = patternSuccessMap.get(phrase)!;
            existing.successCount++;
            existing.total++;
          } else {
            patternSuccessMap.set(phrase, { successCount: 1, total: 1 });
          }
        }
      } else {
        // Count as attempted but not successful
        const phrases = this.extractCommonPhrases(interaction.userInput);
        
        for (const phrase of phrases) {
          if (patternSuccessMap.has(phrase)) {
            const existing = patternSuccessMap.get(phrase)!;
            existing.total++;
          } else {
            patternSuccessMap.set(phrase, { successCount: 0, total: 1 });
          }
        }
      }
    }
    
    return Array.from(patternSuccessMap.entries())
      .map(([pattern, data]) => ({
        pattern,
        successCount: data.successCount,
        successRate: data.total > 0 ? data.successCount / data.total : 0
      }))
      .filter(item => item.successRate > 0) // Only patterns with some success
      .sort((a, b) => b.successRate - a.successRate);
  }

  /**
   * Find patterns that lead to failures
   */
  private findFailurePatterns(): Array<{ pattern: string; failureCount: number; failureRate: number }> {
    const patternFailureMap: Map<string, { failureCount: number; total: number }> = new Map();
    
    for (const interaction of this.interactions) {
      if (interaction.feedbackScore && interaction.feedbackScore < -0.3) { // Negative feedback
        const phrases = this.extractCommonPhrases(interaction.userInput);
        
        for (const phrase of phrases) {
          if (patternFailureMap.has(phrase)) {
            const existing = patternFailureMap.get(phrase)!;
            existing.failureCount++;
            existing.total++;
          } else {
            patternFailureMap.set(phrase, { failureCount: 1, total: 1 });
          }
        }
      } else if (interaction.executionResult && !interaction.executionResult.success) {
        const phrases = this.extractCommonPhrases(interaction.userInput);
        
        for (const phrase of phrases) {
          if (patternFailureMap.has(phrase)) {
            const existing = patternFailureMap.get(phrase)!;
            existing.failureCount++;
            existing.total++;
          } else {
            patternFailureMap.set(phrase, { failureCount: 1, total: 1 });
          }
        }
      } else {
        // Count as attempted but not failed
        const phrases = this.extractCommonPhrases(interaction.userInput);
        
        for (const phrase of phrases) {
          if (patternFailureMap.has(phrase)) {
            const existing = patternFailureMap.get(phrase)!;
            existing.total++;
          } else {
            patternFailureMap.set(phrase, { failureCount: 0, total: 1 });
          }
        }
      }
    }
    
    return Array.from(patternFailureMap.entries())
      .map(([pattern, data]) => ({
        pattern,
        failureCount: data.failureCount,
        failureRate: data.total > 0 ? data.failureCount / data.total : 0
      }))
      .filter(item => item.failureRate > 0) // Only patterns with some failure
      .sort((a, b) => b.failureRate - a.failureRate);
  }

  /**
   * Update internal models based on discovered patterns
   */
  private async updateModelsFromPatterns(
    commonPatterns: Array<{ pattern: string; count: number; examples: string[] }>,
    successfulPatterns: Array<{ pattern: string; successCount: number; successRate: number }>,
    failurePatterns: Array<{ pattern: string; failureCount: number; failureRate: number }>
  ): Promise<void> {
    // Identify high-frequency, high-success patterns as potential new skills
    for (const pattern of successfulPatterns) {
      if (pattern.successRate > 0.8 && pattern.successCount > 5) {
        // This pattern is highly successful, consider creating a skill for it
        await this.createSkillFromPattern(pattern);
      }
    }
    
    // Identify high-frequency, high-failure patterns as adaptation rules to avoid
    for (const pattern of failurePatterns) {
      if (pattern.failureRate > 0.7 && pattern.failureCount > 3) {
        // This pattern often fails, create an adaptation rule
        this.createAdaptationRuleForPattern(pattern);
      }
    }
  }

  /**
   * Create a new skill based on a successful pattern
   */
  private async createSkillFromPattern(pattern: { pattern: string; successCount: number; successRate: number }): Promise<void> {
    const skillId = `auto-skill-${Date.now()}-${Math.random()}`;
    const skill: Skill = {
      id: skillId,
      name: `Auto-learned skill: ${pattern.pattern.substring(0, 30)}...`,
      description: `Automatically learned skill based on pattern: ${pattern.pattern}`,
      category: 'auto-generated',
      parameters: { pattern: pattern.pattern },
      successRate: pattern.successRate,
      usageCount: pattern.successCount,
      lastUsed: new Date(),
      createdAt: new Date(),
      examples: [],
      dependencies: []
    };
    
    this.skills.set(skillId, skill);
  }

  /**
   * Create an adaptation rule to handle a problematic pattern
   */
  private createAdaptationRuleForPattern(pattern: { pattern: string; failureCount: number; failureRate: number }): void {
    const ruleId = `auto-rule-${Date.now()}-${Math.random()}`;
    const rule: AdaptationRule = {
      id: ruleId,
      condition: `User input contains "${pattern.pattern}" and has high failure rate`,
      action: `Handle with extra care or delegate to human`,
      priority: 1, // Lower priority for auto-generated rules
      enabled: true,
      matches: 0,
      positiveOutcomes: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    this.adaptationRules.set(ruleId, rule);
  }

  /**
   * Check if learning interaction contains valuable knowledge
   */
  private isValuableKnowledge(interaction: LearningInteraction): boolean {
    // Consider it valuable if:
    // - It has positive feedback
    // - It solved a complex problem
    // - It contains new information not in knowledge base
    // - It's been requested multiple times
    
    if (interaction.feedbackScore && interaction.feedbackScore > 0.5) {
      return true;
    }
    
    if (interaction.executionResult?.success && interaction.complexityScore && interaction.complexityScore > 0.7) {
      return true;
    }
    
    return false;
  }

  /**
   * Add information to the knowledge base
   */
  private async addToKnowledgeBase(interaction: LearningInteraction): Promise<void> {
    // Create a knowledge node from the interaction
    const nodeId = `kb-${Date.now()}-${Math.random()}`;
    
    // Extract relevant content for the knowledge node
    const content = interaction.executionResult?.outcome || interaction.aiResponse;
    
    const knowledgeNode: KnowledgeNode = {
      id: nodeId,
      content,
      embeddings: interaction.embeddings || [],
      context: {
        userInput: interaction.userInput,
        aiResponse: interaction.aiResponse,
        sessionId: interaction.sessionId,
        executionResult: interaction.executionResult
      },
      source: 'interaction',
      tags: await this.extractTagsFromContent(content),
      relationships: [],
      timestamp: new Date(),
      lastAccessed: new Date(),
      accessCount: 0,
      relevanceScore: interaction.feedbackScore || 0.5
    };
    
    // Find similar knowledge nodes to create relationships
    const similarNodes = await this.findSimilarKnowledgeNodes(knowledgeNode);
    knowledgeNode.relationships = similarNodes.map(node => node.id);
    
    // Add to knowledge base
    this.knowledgeBase.set(nodeId, knowledgeNode);
    
    // Add to vector database for RAG
    try {
      await this.vectorService.upsert([{ id: nodeId, vector: knowledgeNode.embeddings, metadata: knowledgeNode }]);
    } catch (error) {
      console.error('Error adding knowledge node to vector database:', error);
    }
  }

  /**
   * Find similar knowledge nodes
   */
  private async findSimilarKnowledgeNodes(node: KnowledgeNode): Promise<KnowledgeNode[]> {
    if (!node.embeddings || node.embeddings.length === 0) {
      return [];
    }
    
    // Find nodes with similar embeddings
    const similarities: Array<{ node: KnowledgeNode; similarity: number }> = [];
    
    for (const [_, kbNode] of this.knowledgeBase.entries()) {
      if (kbNode.id === node.id) continue; // Skip self
      
      if (kbNode.embeddings && kbNode.embeddings.length > 0) {
        const similarity = this.calculateCosineSimilarity(node.embeddings, kbNode.embeddings);
        if (similarity > 0.7) { // Threshold for similarity
          similarities.push({ node: kbNode, similarity });
        }
      }
    }
    
    // Sort by similarity and return top matches
    return similarities
      .sort((a, b) => b.similarity - a.similarity)
      .map(item => item.node)
      .slice(0, 5); // Return top 5 similar nodes
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private calculateCosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    
    if (normA === 0 || normB === 0) return 0;
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Update skill usage statistics
   */
  private async updateSkillUsage(interaction: LearningInteraction): Promise<void> {
    // In a real implementation, we would identify which skills were used
    // For now, we'll look for skill-related keywords in the interaction
    
    for (const [skillId, skill] of this.skills.entries()) {
      if (interaction.userInput.toLowerCase().includes(skill.name.toLowerCase()) ||
          interaction.aiResponse.toLowerCase().includes(skill.name.toLowerCase())) {
        skill.usageCount++;
        skill.lastUsed = new Date();
        
        // Update success rate if we have feedback
        if (interaction.feedbackScore !== undefined) {
          // Adjust success rate based on feedback
          const newSuccessRate = (skill.successRate * (skill.usageCount - 1) + 
                                 (interaction.feedbackScore > 0 ? 1 : 0)) / skill.usageCount;
          skill.successRate = newSuccessRate;
        }
        
        this.skills.set(skillId, skill);
      }
    }
  }

  /**
   * Update knowledge base with new insights
   */
  private async updateKnowledgeBase(): Promise<void> {
    // This would typically involve:
    // - Consolidating similar knowledge nodes
    // - Updating relevance scores based on usage
    // - Creating new relationships between nodes
    // - Pruning outdated information
    
    // For now, let's update access counts and relevance scores
    for (const [id, node] of this.knowledgeBase.entries()) {
      // Update relevance based on recent access and feedback
      node.lastAccessed = new Date();
      node.accessCount++;
      
      // In a real system, we'd have more sophisticated relevance calculation
      if (node.relevanceScore < 1) {
        node.relevanceScore = Math.min(1, node.relevanceScore + 0.01); // Small boost for being accessed
      }
      
      this.knowledgeBase.set(id, node);
    }
  }

  /**
   * Refine and create new skills based on usage patterns
   */
  private async refineSkills(): Promise<void> {
    // Identify skills that are frequently used but have low success rates
    for (const [skillId, skill] of this.skills.entries()) {
      if (skill.usageCount > 10 && skill.successRate < 0.7) {
        // This skill needs refinement
        console.log(`Skill ${skill.name} needs refinement: low success rate (${skill.successRate}) with high usage (${skill.usageCount})`);
      }
      
      if (skill.usageCount > 50 && skill.successRate > 0.9) {
        // This skill is highly effective, consider promoting it
        console.log(`Skill ${skill.name} is highly effective: high success rate (${skill.successRate}) with high usage (${skill.usageCount})`);
      }
    }
  }

  /**
   * Generate adaptation rules based on context and usage
   */
  private async generateAdaptationRules(): Promise<void> {
    // This would analyze usage patterns and create rules to adapt behavior
    // For example: "If user asks for sensitive info, verify identity first"
    
    // In a real implementation, we would identify common adaptation needs
    // from the interaction patterns and create rules accordingly
  }

  /**
   * Clean up old/unused knowledge from the knowledge base
   */
  private async cleanKnowledgeBase(): Promise<void> {
    const now = new Date();
    const cutoffDate = new Date(now.getTime() - (this.knowledgeRetentionDays * 24 * 60 * 60 * 1000));
    
    // Remove nodes that are old and rarely accessed
    for (const [id, node] of this.knowledgeBase.entries()) {
      if (node.timestamp < cutoffDate && node.accessCount < 2) {
        // Remove if old and rarely accessed
        this.knowledgeBase.delete(id);
      } else if (this.knowledgeBase.size > this.maxKnowledgeNodes) {
        // Remove least accessed nodes if we exceed the max
        const nodes = Array.from(this.knowledgeBase.entries())
          .sort((a, b) => a[1].accessCount - b[1].accessCount);
        
        if (nodes.length > this.maxKnowledgeNodes) {
          const toRemove = nodes.slice(0, nodes.length - this.maxKnowledgeNodes);
          for (const [removeId] of toRemove) {
            this.knowledgeBase.delete(removeId);
          }
        }
      }
    }
  }

  /**
   * Update performance metrics
   */
  private async updatePerformanceMetrics(): Promise<void> {
    // This would update metrics for the learning system's performance
    // In a real system, these would be stored and tracked over time
    const metrics: LearningMetrics = {
      totalInteractions: this.interactions.length,
      totalLearnings: this.knowledgeBase.size,
      knowledgeBaseSize: this.knowledgeBase.size,
      skillCount: this.skills.size,
      adaptationRules: this.adaptationRules.size,
      lastLearningCycle: new Date(),
      performanceTrend: 0.05, // Placeholder
      accuracyImprovement: 0.02 // Placeholder
    };
    
    console.log('Learning metrics updated:', metrics);
  }

  /**
   * Generate embeddings for text content
   */
  private async generateEmbeddings(content: string): Promise<number[]> {
    try {
      // Use the injected vector service to generate real embeddings
      const embeddings = await this.vectorService.generateEmbeddings([content]);

      if (embeddings && embeddings.length > 0) {
        return embeddings[0];
      }

      throw new Error('Vector service returned empty embeddings');
    } catch (error) {
      console.error('Failed to generate embeddings:', error);
      throw new Error(`Embedding generation failed: ${(error as Error).message}`);
    }
  }

  /**
   * Extract common phrases from text
   */
  private extractCommonPhrases(text: string): string[] {
    // Simple keyword extraction for demonstration
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3); // Only words longer than 3 chars
    
    // Return top 5 most frequent words
    const wordCount: Map<string, number> = new Map();
    for (const word of words) {
      wordCount.set(word, (wordCount.get(word) || 0) + 1);
    }
    
    return Array.from(wordCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(entry => entry[0]);
  }

  /**
   * Extract tags from content
   */
  private async extractTagsFromContent(content: string): Promise<string[]> {
    // In a real implementation, this would use NLP to extract meaningful tags
    // For now, return common technical tags found in the content
    const tags: string[] = [];
    const lowerContent = content.toLowerCase();
    
    if (lowerContent.includes('cloudflare') || lowerContent.includes('worker')) {
      tags.push('cloudflare', 'infrastructure');
    }
    if (lowerContent.includes('docker') || lowerContent.includes('container')) {
      tags.push('docker', 'containerization');
    }
    if (lowerContent.includes('ai') || lowerContent.includes('model')) {
      tags.push('ai', 'machine-learning');
    }
    if (lowerContent.includes('security') || lowerContent.includes('protect')) {
      tags.push('security', 'protection');
    }
    
    return tags;
  }

  /**
   * Search the knowledge base for relevant information
   */
  async searchKnowledgeBase(query: string, topK: number = 5): Promise<KnowledgeNode[]> {
    // Generate embeddings for the query
    const queryEmbeddings = await this.generateEmbeddings(query);
    
    // Find similar knowledge nodes
    const similarities: Array<{ node: KnowledgeNode; similarity: number }> = [];
    
    for (const [_, node] of this.knowledgeBase.entries()) {
      if (node.embeddings && node.embeddings.length > 0) {
        const similarity = this.calculateCosineSimilarity(queryEmbeddings, node.embeddings);
        similarities.push({ node, similarity });
      }
    }
    
    // Sort by similarity and return top K
    return similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK)
      .map(item => item.node);
  }

  /**
   * Get relevant skills for a given task
   */
  async getRelevantSkills(taskDescription: string): Promise<Skill[]> {
    const taskLower = taskDescription.toLowerCase();
    const relevantSkills: Skill[] = [];
    
    for (const skill of this.skills.values()) {
      if (taskLower.includes(skill.name.toLowerCase()) ||
          taskLower.includes(skill.category.toLowerCase()) ||
          skill.tags?.some(tag => taskLower.includes(tag.toLowerCase()))) {
        relevantSkills.push(skill);
      }
    }
    
    // Sort by success rate and usage
    return relevantSkills.sort((a, b) => {
      if (b.successRate !== a.successRate) return b.successRate - a.successRate;
      return b.usageCount - a.usageCount;
    });
  }

  /**
   * Apply adaptation rules to a given context
   */
  applyAdaptationRules(context: any): string[] {
    const applicableRules: string[] = [];
    
    for (const rule of this.adaptationRules.values()) {
      if (rule.enabled && this.evaluateRuleCondition(rule.condition, context)) {
        applicableRules.push(rule.action);
        rule.matches++;
        rule.updatedAt = new Date();
      }
    }
    
    return applicableRules;
  }

  /**
   * Evaluate if a rule condition is met
   */
  private evaluateRuleCondition(condition: string, context: any): boolean {
    // Simple pattern matching for demonstration
    // In a real implementation, this would be more sophisticated
    return condition.includes('*'); // Placeholder logic
  }

  /**
   * Get current learning metrics
   */
  getLearningMetrics(): LearningMetrics {
    return {
      totalInteractions: this.interactions.length,
      totalLearnings: this.knowledgeBase.size,
      knowledgeBaseSize: this.knowledgeBase.size,
      skillCount: this.skills.size,
      adaptationRules: this.adaptationRules.size,
      lastLearningCycle: new Date(), // In real implementation, track actual time
      performanceTrend: 0.05,
      accuracyImprovement: 0.02
    };
  }

  /**
   * Get all stored interactions
   */
  getInteractions(): LearningInteraction[] {
    return [...this.interactions];
  }

  /**
   * Get all knowledge nodes
   */
  getKnowledgeBase(): KnowledgeNode[] {
    return Array.from(this.knowledgeBase.values());
  }

  /**
   * Get all skills
   */
  getSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Get all adaptation rules
   */
  getAdaptationRules(): AdaptationRule[] {
    return Array.from(this.adaptationRules.values());
  }

  /**
   * Enable or disable learning
   */
  setLearningEnabled(enabled: boolean): void {
    this.learningEnabled = enabled;
  }

  /**
   * Reset the learning system
   */
  resetLearningSystem(): void {
    this.interactions = [];
    this.knowledgeBase.clear();
    this.skills.clear();
    this.adaptationRules.clear();
    console.log('Learning system has been reset');
  }
}

// Initialize Advanced Self Evolving Service middleware
export const initializeAdvancedSelfEvolving = async (c: Context, next: () => Promise<void>) => {
  const configService = c.get('configService');
  const ragService = c.get('ragService');
  const vectorService = c.get('vectorService');
  
  // In backend mode, these services might not be available (Cloudflare Workers only)
  // Create the service only if dependencies are available
  if (configService && ragService && vectorService) {
    const advancedSelfEvolvingService = new AdvancedSelfEvolvingService(configService, ragService, vectorService);
    c.set('advancedSelfEvolvingService', advancedSelfEvolvingService);
  } else {
    console.warn('Advanced self-evolving service disabled: RAG/Vector services not available (backend mode)');
    // Set a null value so downstream code knows the service is intentionally not available
    c.set('advancedSelfEvolvingService', null);
  }
  
  await next();
};
