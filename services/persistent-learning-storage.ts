/**
 * Persistent Learning Storage Service
 * Manages all persistent storage for the self-learning system
 * Uses: D1 (metadata), Vectorize (embeddings), KV (cache), Durable Objects (state)
 */

import { CloudflareEmbeddingsService } from './cloudflare-embeddings';

export interface StoredInteraction {
  id: string;
  sessionId: string;
  userId?: string;
  userInput: string;
  aiResponse: string;
  context?: any;
  timestamp: string;
  feedbackScore?: number;
  executionSuccess?: boolean;
  executionOutcome?: string;
  executionError?: string;
  intent?: string;
  complexityScore?: number;
  responseQuality?: number;
  knowledgeTags?: string[];
  vectorizeId?: string;
}

export interface StoredKnowledgeNode {
  id: string;
  content: string;
  vectorizeId: string;
  context?: any;
  source: string;
  tags: string[];
  relationships: string[];
  timestamp: string;
  lastAccessed: string;
  accessCount: number;
  relevanceScore: number;
}

export interface StoredSkill {
  id: string;
  name: string;
  description: string;
  category: string;
  parameters?: any;
  successRate: number;
  usageCount: number;
  lastUsed?: string;
  createdAt: string;
  examples?: string[];
  dependencies?: string[];
}

export interface StoredAdaptationRule {
  id: string;
  condition: string;
  action: string;
  priority: number;
  enabled: boolean;
  matches: number;
  positiveOutcomes: number;
  createdAt: string;
  updatedAt: string;
}

export interface StoredPattern {
  pattern: string;
  patternType: 'common' | 'success' | 'failure';
  count: number;
  successCount: number;
  failureCount: number;
  examples: string[];
  lastUpdated: string;
}

export class PersistentLearningStorage {
  private db: D1Database;
  private vectorize: VectorizeIndex;
  private kv: KVNamespace;
  private embeddings: CloudflareEmbeddingsService;
  private durableObject: DurableObjectNamespace;

  constructor(
    db: D1Database,
    vectorize: VectorizeIndex,
    kv: KVNamespace,
    embeddingsService: CloudflareEmbeddingsService,
    durableObject: DurableObjectNamespace
  ) {
    this.db = db;
    this.vectorize = vectorize;
    this.kv = kv;
    this.embeddings = embeddingsService;
    this.durableObject = durableObject;
  }

  // ==================== INTERACTIONS ====================

  async storeInteraction(interaction: StoredInteraction): Promise<void> {
    // Generate embedding and store in Vectorize
    const content = `${interaction.userInput} ${interaction.aiResponse}`;
    const embedding = await this.embeddings.generateEmbedding(content);

    // Store in Vectorize
    const vectorizeId = `interaction-${interaction.id}`;
    await this.vectorize.upsert([{
      id: vectorizeId,
      values: embedding,
      metadata: {
        type: 'interaction',
        interactionId: interaction.id,
        sessionId: interaction.sessionId,
        timestamp: interaction.timestamp
      }
    }]);

    // Store metadata in D1
    await this.db.prepare(`
      INSERT INTO learning_interactions (
        id, session_id, user_id, user_input, ai_response, context,
        timestamp, feedback_score, execution_success, execution_outcome,
        execution_error, intent, complexity_score, response_quality,
        knowledge_tags, vectorize_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      interaction.id,
      interaction.sessionId,
      interaction.userId || null,
      interaction.userInput,
      interaction.aiResponse,
      interaction.context ? JSON.stringify(interaction.context) : null,
      interaction.timestamp,
      interaction.feedbackScore || null,
      interaction.executionSuccess ? 1 : 0,
      interaction.executionOutcome || null,
      interaction.executionError || null,
      interaction.intent || null,
      interaction.complexityScore || null,
      interaction.responseQuality || null,
      interaction.knowledgeTags ? JSON.stringify(interaction.knowledgeTags) : null,
      vectorizeId
    ).run();

    // Invalidate cache
    await this.kv.delete('interactions:recent');
  }

  async getInteractions(limit: number = 100, offset: number = 0): Promise<StoredInteraction[]> {
    // Try cache first
    const cacheKey = `interactions:${limit}:${offset}`;
    const cached = await this.kv.get(cacheKey, 'json');
    if (cached) {
      return cached as StoredInteraction[];
    }

    const result = await this.db.prepare(`
      SELECT * FROM learning_interactions
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `).bind(limit, offset).all();

    const interactions = result.results.map(row => this.mapInteractionRow(row));

    // Cache for 5 minutes
    await this.kv.put(cacheKey, JSON.stringify(interactions), { expirationTtl: 300 });

    return interactions;
  }

  async searchInteractionsByEmbedding(queryText: string, topK: number = 5): Promise<StoredInteraction[]> {
    const queryEmbedding = await this.embeddings.generateEmbedding(queryText);

    const results = await this.vectorize.query(queryEmbedding, {
      topK,
      filter: { type: 'interaction' }
    });

    const interactionIds = results.matches.map(m => m.metadata.interactionId as string);

    if (interactionIds.length === 0) {
      return [];
    }

    const placeholders = interactionIds.map(() => '?').join(',');
    const result = await this.db.prepare(`
      SELECT * FROM learning_interactions
      WHERE id IN (${placeholders})
    `).bind(...interactionIds).all();

    return result.results.map(row => this.mapInteractionRow(row));
  }

  // ==================== KNOWLEDGE NODES ====================

  async storeKnowledgeNode(node: StoredKnowledgeNode): Promise<void> {
    // Generate embedding and store in Vectorize
    const embedding = await this.embeddings.generateEmbedding(node.content);

    await this.vectorize.upsert([{
      id: node.vectorizeId,
      values: embedding,
      metadata: {
        type: 'knowledge',
        nodeId: node.id,
        source: node.source,
        tags: node.tags,
        timestamp: node.timestamp
      }
    }]);

    // Store metadata in D1
    await this.db.prepare(`
      INSERT OR REPLACE INTO knowledge_nodes (
        id, content, vectorize_id, context, source, tags,
        relationships, timestamp, last_accessed, access_count, relevance_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      node.id,
      node.content,
      node.vectorizeId,
      node.context ? JSON.stringify(node.context) : null,
      node.source,
      JSON.stringify(node.tags),
      JSON.stringify(node.relationships),
      node.timestamp,
      node.lastAccessed,
      node.accessCount,
      node.relevanceScore
    ).run();

    // Invalidate cache
    await this.kv.delete('knowledge:all');
  }

  async getKnowledgeNode(id: string): Promise<StoredKnowledgeNode | null> {
    // Try cache first
    const cacheKey = `knowledge:${id}`;
    const cached = await this.kv.get(cacheKey, 'json');
    if (cached) {
      return cached as StoredKnowledgeNode;
    }

    const result = await this.db.prepare(`
      SELECT * FROM knowledge_nodes WHERE id = ?
    `).bind(id).first();

    if (!result) {
      return null;
    }

    const node = this.mapKnowledgeNodeRow(result);

    // Cache for 10 minutes
    await this.kv.put(cacheKey, JSON.stringify(node), { expirationTtl: 600 });

    return node;
  }

  async searchKnowledgeByEmbedding(queryText: string, topK: number = 5): Promise<StoredKnowledgeNode[]> {
    const queryEmbedding = await this.embeddings.generateEmbedding(queryText);

    const results = await this.vectorize.query(queryEmbedding, {
      topK,
      filter: { type: 'knowledge' }
    });

    const nodeIds = results.matches.map(m => m.metadata.nodeId as string);

    if (nodeIds.length === 0) {
      return [];
    }

    const placeholders = nodeIds.map(() => '?').join(',');
    const result = await this.db.prepare(`
      SELECT * FROM knowledge_nodes
      WHERE id IN (${placeholders})
    `).bind(...nodeIds).all();

    // Update access counts
    for (const nodeId of nodeIds) {
      await this.updateKnowledgeAccess(nodeId);
    }

    return result.results.map(row => this.mapKnowledgeNodeRow(row));
  }

  async updateKnowledgeAccess(id: string): Promise<void> {
    await this.db.prepare(`
      UPDATE knowledge_nodes
      SET access_count = access_count + 1,
          last_accessed = datetime('now')
      WHERE id = ?
    `).bind(id).run();

    // Invalidate cache
    await this.kv.delete(`knowledge:${id}`);
  }

  async getAllKnowledge(limit: number = 1000): Promise<StoredKnowledgeNode[]> {
    const result = await this.db.prepare(`
      SELECT * FROM knowledge_nodes
      ORDER BY relevance_score DESC, access_count DESC
      LIMIT ?
    `).bind(limit).all();

    return result.results.map(row => this.mapKnowledgeNodeRow(row));
  }

  async deleteOldKnowledge(cutoffDate: string, minAccessCount: number = 2): Promise<number> {
    const result = await this.db.prepare(`
      DELETE FROM knowledge_nodes
      WHERE timestamp < ? AND access_count < ?
    `).bind(cutoffDate, minAccessCount).run();

    // Clear cache
    await this.kv.delete('knowledge:all');

    return result.meta.changes;
  }

  // ==================== SKILLS ====================

  async storeSkill(skill: StoredSkill): Promise<void> {
    await this.db.prepare(`
      INSERT OR REPLACE INTO skills (
        id, name, description, category, parameters,
        success_rate, usage_count, last_used, created_at,
        examples, dependencies
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      skill.id,
      skill.name,
      skill.description,
      skill.category,
      skill.parameters ? JSON.stringify(skill.parameters) : null,
      skill.successRate,
      skill.usageCount,
      skill.lastUsed || null,
      skill.createdAt,
      skill.examples ? JSON.stringify(skill.examples) : null,
      skill.dependencies ? JSON.stringify(skill.dependencies) : null
    ).run();

    // Invalidate cache
    await this.kv.delete('skills:all');
  }

  async getSkill(id: string): Promise<StoredSkill | null> {
    const result = await this.db.prepare(`
      SELECT * FROM skills WHERE id = ?
    `).bind(id).first();

    if (!result) {
      return null;
    }

    return this.mapSkillRow(result);
  }

  async getAllSkills(): Promise<StoredSkill[]> {
    // Try cache first
    const cached = await this.kv.get('skills:all', 'json');
    if (cached) {
      return cached as StoredSkill[];
    }

    const result = await this.db.prepare(`
      SELECT * FROM skills
      ORDER BY success_rate DESC, usage_count DESC
    `).all();

    const skills = result.results.map(row => this.mapSkillRow(row));

    // Cache for 10 minutes
    await this.kv.put('skills:all', JSON.stringify(skills), { expirationTtl: 600 });

    return skills;
  }

  async updateSkillUsage(id: string, success: boolean): Promise<void> {
    const skill = await this.getSkill(id);
    if (!skill) {
      return;
    }

    const newSuccessRate = (skill.successRate * skill.usageCount + (success ? 1 : 0)) / (skill.usageCount + 1);

    await this.db.prepare(`
      UPDATE skills
      SET usage_count = usage_count + 1,
          success_rate = ?,
          last_used = datetime('now')
      WHERE id = ?
    `).bind(newSuccessRate, id).run();

    // Invalidate cache
    await this.kv.delete('skills:all');
  }

  // ==================== ADAPTATION RULES ====================

  async storeAdaptationRule(rule: StoredAdaptationRule): Promise<void> {
    await this.db.prepare(`
      INSERT OR REPLACE INTO adaptation_rules (
        id, condition, action, priority, enabled,
        matches, positive_outcomes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      rule.id,
      rule.condition,
      rule.action,
      rule.priority,
      rule.enabled ? 1 : 0,
      rule.matches,
      rule.positiveOutcomes,
      rule.createdAt,
      rule.updatedAt
    ).run();

    // Invalidate cache
    await this.kv.delete('rules:enabled');
  }

  async getEnabledRules(): Promise<StoredAdaptationRule[]> {
    // Try cache first
    const cached = await this.kv.get('rules:enabled', 'json');
    if (cached) {
      return cached as StoredAdaptationRule[];
    }

    const result = await this.db.prepare(`
      SELECT * FROM adaptation_rules
      WHERE enabled = 1
      ORDER BY priority DESC
    `).all();

    const rules = result.results.map(row => this.mapAdaptationRuleRow(row));

    // Cache for 5 minutes
    await this.kv.put('rules:enabled', JSON.stringify(rules), { expirationTtl: 300 });

    return rules;
  }

  async updateRuleMatch(id: string, positive: boolean): Promise<void> {
    await this.db.prepare(`
      UPDATE adaptation_rules
      SET matches = matches + 1,
          positive_outcomes = positive_outcomes + ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).bind(positive ? 1 : 0, id).run();

    // Invalidate cache
    await this.kv.delete('rules:enabled');
  }

  // ==================== PATTERNS ====================

  async storePattern(pattern: StoredPattern): Promise<void> {
    await this.db.prepare(`
      INSERT OR REPLACE INTO pattern_cache (
        pattern, pattern_type, count, success_count,
        failure_count, examples, last_updated
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      pattern.pattern,
      pattern.patternType,
      pattern.count,
      pattern.successCount,
      pattern.failureCount,
      JSON.stringify(pattern.examples),
      pattern.lastUpdated
    ).run();
  }

  async getPatterns(type: 'common' | 'success' | 'failure', limit: number = 100): Promise<StoredPattern[]> {
    const result = await this.db.prepare(`
      SELECT * FROM pattern_cache
      WHERE pattern_type = ?
      ORDER BY count DESC
      LIMIT ?
    `).bind(type, limit).all();

    return result.results.map(row => this.mapPatternRow(row));
  }

  // ==================== HELPER METHODS ====================

  private mapInteractionRow(row: any): StoredInteraction {
    return {
      id: row.id as string,
      sessionId: row.session_id as string,
      userId: row.user_id as string | undefined,
      userInput: row.user_input as string,
      aiResponse: row.ai_response as string,
      context: row.context ? JSON.parse(row.context as string) : undefined,
      timestamp: row.timestamp as string,
      feedbackScore: row.feedback_score as number | undefined,
      executionSuccess: (row.execution_success as number) === 1,
      executionOutcome: row.execution_outcome as string | undefined,
      executionError: row.execution_error as string | undefined,
      intent: row.intent as string | undefined,
      complexityScore: row.complexity_score as number | undefined,
      responseQuality: row.response_quality as number | undefined,
      knowledgeTags: row.knowledge_tags ? JSON.parse(row.knowledge_tags as string) : undefined,
      vectorizeId: row.vectorize_id as string | undefined
    };
  }

  private mapKnowledgeNodeRow(row: any): StoredKnowledgeNode {
    return {
      id: row.id as string,
      content: row.content as string,
      vectorizeId: row.vectorize_id as string,
      context: row.context ? JSON.parse(row.context as string) : undefined,
      source: row.source as string,
      tags: JSON.parse(row.tags as string),
      relationships: JSON.parse(row.relationships as string),
      timestamp: row.timestamp as string,
      lastAccessed: row.last_accessed as string,
      accessCount: row.access_count as number,
      relevanceScore: row.relevance_score as number
    };
  }

  private mapSkillRow(row: any): StoredSkill {
    return {
      id: row.id as string,
      name: row.name as string,
      description: row.description as string,
      category: row.category as string,
      parameters: row.parameters ? JSON.parse(row.parameters as string) : undefined,
      successRate: row.success_rate as number,
      usageCount: row.usage_count as number,
      lastUsed: row.last_used as string | undefined,
      createdAt: row.created_at as string,
      examples: row.examples ? JSON.parse(row.examples as string) : undefined,
      dependencies: row.dependencies ? JSON.parse(row.dependencies as string) : undefined
    };
  }

  private mapAdaptationRuleRow(row: any): StoredAdaptationRule {
    return {
      id: row.id as string,
      condition: row.condition as string,
      action: row.action as string,
      priority: row.priority as number,
      enabled: (row.enabled as number) === 1,
      matches: row.matches as number,
      positiveOutcomes: row.positive_outcomes as number,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string
    };
  }

  private mapPatternRow(row: any): StoredPattern {
    return {
      pattern: row.pattern as string,
      patternType: row.pattern_type as 'common' | 'success' | 'failure',
      count: row.count as number,
      successCount: row.success_count as number,
      failureCount: row.failure_count as number,
      examples: JSON.parse(row.examples as string),
      lastUpdated: row.last_updated as string
    };
  }
}
