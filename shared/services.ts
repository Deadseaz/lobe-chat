/**
 * Shared Services - AI Gateway, RAG, Vector operations
 * Core services used across the agent system
 */

import { config, ConfigService } from './config';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  usage?: { totalTokens: number };
}

export interface VectorSearchResult {
  id: string;
  score: number;
  payload?: Record<string, any>;
}

/**
 * AI Gateway Service - Routes AI requests through the gateway
 */
export class AIGateway {
  private baseUrl: string;
  private authToken?: string;
  private timeout: number;

  constructor(configService?: ConfigService) {
    const cfg = configService?.getAIGateway() || config.getAIGateway();
    this.baseUrl = cfg.url;
    this.authToken = cfg.authToken;
    this.timeout = cfg.timeout || 120000;
  }

  /**
   * Send a chat completion request
   */
  async chatCompletion(messages: ChatMessage[], options?: ChatCompletionOptions): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.authToken && { 'Authorization': `Bearer ${this.authToken}` })
        },
        body: JSON.stringify({
          model: options?.model || 'dynamic/RE_Ant',
          messages,
          temperature: options?.temperature ?? 0.7,
          max_tokens: options?.maxTokens ?? 2048,
          stream: options?.stream ?? false
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`AI Gateway error: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Generate embeddings for text
   */
  async createEmbedding(text: string | string[], model?: string): Promise<EmbeddingResult[]> {
    const texts = Array.isArray(text) ? text : [text];
    
    const response = await fetch(`${this.baseUrl}/v1/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.authToken && { 'Authorization': `Bearer ${this.authToken}` })
      },
      body: JSON.stringify({
        model: model || 'text-embedding-ada-002',
        input: texts
      })
    });

    if (!response.ok) {
      throw new Error(`Embedding error: ${response.status}`);
    }

    const data: any = await response.json();
    return data.data.map((item: any) => ({
      embedding: item.embedding,
      model: data.model,
      usage: data.usage
    }));
  }

  /**
   * Simple completion (non-chat)
   */
  async completion(prompt: string, options?: ChatCompletionOptions): Promise<string> {
    const result = await this.chatCompletion([
      { role: 'user', content: prompt }
    ], options);

    return result.choices[0]?.message?.content || '';
  }

  /**
   * Alias for chatCompletion (compatibility)
   */
  async chat(messages: ChatMessage[], options?: ChatCompletionOptions): Promise<any> {
    return this.chatCompletion(messages, options);
  }
}

/**
 * Vector Service - Interfaces with Qdrant for vector operations
 */
export class VectorService {
  private qdrantUrl: string;
  private collectionName: string;

  constructor(qdrantUrl?: string, collectionName?: string) {
    this.qdrantUrl = qdrantUrl || config.getVectors().qdrantUrl;
    this.collectionName = collectionName || 'agent_knowledge';
  }

  /**
   * Ensure collection exists
   */
  async ensureCollection(vectorSize: number = 1536): Promise<void> {
    try {
      // Check if collection exists
      const checkResponse = await fetch(`${this.qdrantUrl}/collections/${this.collectionName}`);
      if (checkResponse.ok) return;

      // Create collection
      await fetch(`${this.qdrantUrl}/collections/${this.collectionName}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vectors: {
            size: vectorSize,
            distance: 'Cosine'
          }
        })
      });
    } catch (error) {
      console.warn('Could not ensure collection:', error);
    }
  }

  /**
   * Upsert vectors
   */
  async upsert(points: Array<{ id: string; vector: number[]; payload?: Record<string, any> }>): Promise<void> {
    const response = await fetch(`${this.qdrantUrl}/collections/${this.collectionName}/points`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        points: points.map(p => ({
          id: p.id,
          vector: p.vector,
          payload: p.payload || {}
        }))
      })
    });

    if (!response.ok) {
      throw new Error(`Vector upsert failed: ${response.status}`);
    }
  }

  /**
   * Search for similar vectors
   */
  async search(vector: number[], limit: number = 10, filter?: any): Promise<VectorSearchResult[]> {
    const response = await fetch(`${this.qdrantUrl}/collections/${this.collectionName}/points/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vector,
        limit,
        with_payload: true,
        ...(filter && { filter })
      })
    });

    if (!response.ok) {
      throw new Error(`Vector search failed: ${response.status}`);
    }

    const data: any = await response.json();
    return data.result.map((r: any) => ({
      id: r.id,
      score: r.score,
      payload: r.payload
    }));
  }

  /**
   * Delete vectors by ID
   */
  async delete(ids: string[]): Promise<void> {
    await fetch(`${this.qdrantUrl}/collections/${this.collectionName}/points/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points: ids })
    });
  }
}

/**
 * RAG Service - Retrieval Augmented Generation
 */
export class RAGService {
  private aiGateway: AIGateway;
  private vectorService: VectorService;

  constructor(aiGateway?: AIGateway, vectorService?: VectorService) {
    this.aiGateway = aiGateway || new AIGateway();
    this.vectorService = vectorService || new VectorService();
  }

  /**
   * Add document to knowledge base
   */
  async addDocument(id: string, content: string, metadata?: Record<string, any>): Promise<void> {
    // Generate embedding
    const embeddings = await this.aiGateway.createEmbedding(content);
    
    // Store in vector database
    await this.vectorService.upsert([{
      id,
      vector: embeddings[0].embedding,
      payload: {
        content,
        ...metadata,
        addedAt: new Date().toISOString()
      }
    }]);
  }

  /**
   * Query with RAG - retrieves relevant context and generates response
   */
  async query(question: string, options?: { 
    topK?: number;
    includeContext?: boolean;
    systemPrompt?: string;
  }): Promise<{ answer: string; sources: VectorSearchResult[] }> {
    // Generate embedding for question
    const questionEmbedding = await this.aiGateway.createEmbedding(question);
    
    // Search for relevant documents
    const results = await this.vectorService.search(
      questionEmbedding[0].embedding,
      options?.topK || 5
    );

    // Build context from results
    const context = results
      .map(r => r.payload?.content || '')
      .filter(c => c.length > 0)
      .join('\n\n---\n\n');

    // Generate response with context
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: options?.systemPrompt || 
          'You are a helpful assistant. Use the provided context to answer questions accurately. If the context doesn\'t contain relevant information, say so.'
      },
      {
        role: 'user',
        content: context ? 
          `Context:\n${context}\n\nQuestion: ${question}` : 
          question
      }
    ];

    const response = await this.aiGateway.chatCompletion(messages);
    
    return {
      answer: response.choices[0]?.message?.content || 'No response generated',
      sources: options?.includeContext ? results : []
    };
  }

  /**
   * Search knowledge base without generating response
   */
  async search(query: string, limit?: number): Promise<VectorSearchResult[]> {
    const embedding = await this.aiGateway.createEmbedding(query);
    return this.vectorService.search(embedding[0].embedding, limit);
  }
}

// Export singleton instances
export const aiGateway = new AIGateway();
export const vectorService = new VectorService();
export const ragService = new RAGService(aiGateway, vectorService);
