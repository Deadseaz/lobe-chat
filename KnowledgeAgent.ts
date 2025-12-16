/**
 * KnowledgeAgent - Handles knowledge base queries, RAG, and learning operations
 */

import { BaseAgent } from './BaseAgent';
import { AgentType, AgentTask, TaskResult, AgentCapability } from './types';

export class KnowledgeAgent extends BaseAgent {
  private vectorService: any;
  private selfLearningService: any;
  private aiGatewayService: any;

  constructor(context: any) {
    const capabilities: AgentCapability[] = [
      {
        name: 'knowledge-query',
        description: 'Query knowledge base using RAG',
        requiredServices: ['vectorService', 'aiGatewayService']
      },
      {
        name: 'document-embedding',
        description: 'Embed documents into knowledge base',
        requiredServices: ['vectorService', 'aiGatewayService']
      },
      {
        name: 'semantic-search',
        description: 'Perform semantic search across knowledge base',
        requiredServices: ['vectorService']
      },
      {
        name: 'learning',
        description: 'Learn from new information and user feedback',
        requiredServices: ['selfLearningService']
      }
    ];

    super(
      `knowledge-${Date.now()}`,
      'KnowledgeAgent',
      AgentType.KNOWLEDGE,
      capabilities,
      context
    );

    this.vectorService = context.services?.vectorService;
    this.selfLearningService = context.services?.selfLearningService;
    this.aiGatewayService = context.services?.aiGatewayService;
  }

  protected async executeTask(task: AgentTask): Promise<TaskResult> {
    console.log(`[KnowledgeAgent] Executing task: ${task.type}`);

    try {
      switch (task.type) {
        case 'query-knowledge':
          return await this.queryKnowledge(task);

        case 'embed-document':
          return await this.embedDocument(task);

        case 'semantic-search':
          return await this.semanticSearch(task);

        case 'learn-from-text':
          return await this.learnFromText(task);

        case 'answer-question':
          return await this.answerQuestion(task);

        case 'get-learning-history':
          return await this.getLearningHistory(task);

        case 'provide-feedback':
          return await this.provideFeedback(task);

        default:
          return {
            success: false,
            error: `Unknown task type: ${task.type}`
          };
      }
    } catch (error) {
      console.error(`[KnowledgeAgent] Task execution error:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  // ============================================================================
  // Knowledge Query Operations
  // ============================================================================

  private async queryKnowledge(task: AgentTask): Promise<TaskResult> {
    if (!this.vectorService || !this.aiGatewayService) {
      return {
        success: false,
        error: 'Vector service or AI Gateway not available'
      };
    }

    const { query, topK } = task.payload;

    try {
      // Generate query embedding
      const embeddingResponse = await this.aiGatewayService.requestModel(
        '@cf/baai/bge-large-en-v1.5',
        { text: query }
      );

      if (!embeddingResponse.success || !embeddingResponse.result) {
        return {
          success: false,
          error: 'Failed to generate query embedding'
        };
      }

      // Query vector database
      const results = await this.vectorService.query(
        embeddingResponse.result.data[0],
        topK || 5
      );

      return {
        success: true,
        data: {
          query,
          results: results.map((r: any) => ({
            text: r.vector.metadata?.text,
            score: r.score,
            metadata: r.vector.metadata
          })),
          totalResults: results.length
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async semanticSearch(task: AgentTask): Promise<TaskResult> {
    if (!this.vectorService) {
      return { success: false, error: 'Vector service not available' };
    }

    const { query, filters, limit } = task.payload;

    try {
      // For semantic search, we need embeddings
      if (!this.aiGatewayService) {
        return { success: false, error: 'AI Gateway not available for embedding generation' };
      }

      const embeddingResponse = await this.aiGatewayService.requestModel(
        '@cf/baai/bge-large-en-v1.5',
        { text: query }
      );

      if (!embeddingResponse.success) {
        return { success: false, error: 'Failed to generate embedding' };
      }

      const results = await this.vectorService.query(
        embeddingResponse.result.data[0],
        limit || 10
      );

      // Apply filters if provided
      let filteredResults = results;
      if (filters) {
        filteredResults = results.filter((r: any) => {
          return Object.entries(filters).every(([key, value]) =>
            r.vector.metadata?.[key] === value
          );
        });
      }

      return {
        success: true,
        data: {
          query,
          results: filteredResults.map((r: any) => ({
            id: r.vector.id,
            text: r.vector.metadata?.text,
            score: r.score,
            metadata: r.vector.metadata
          })),
          totalResults: filteredResults.length
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  // ============================================================================
  // Document Embedding Operations
  // ============================================================================

  private async embedDocument(task: AgentTask): Promise<TaskResult> {
    if (!this.vectorService || !this.aiGatewayService) {
      return {
        success: false,
        error: 'Vector service or AI Gateway not available'
      };
    }

    const { text, metadata, chunkSize } = task.payload;

    try {
      // Chunk the document
      const chunks = this.chunkText(text, chunkSize || 1000);
      const vectors = [];

      // Generate embeddings for each chunk
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];

        const embeddingResponse = await this.aiGatewayService.requestModel(
          '@cf/baai/bge-large-en-v1.5',
          { text: chunk }
        );

        if (!embeddingResponse.success || !embeddingResponse.result) {
          console.warn(`Failed to embed chunk ${i}`);
          continue;
        }

        vectors.push({
          id: `${metadata?.id || this.generateId()}_chunk_${i}`,
          embedding: embeddingResponse.result.data[0],
          metadata: {
            ...metadata,
            text: chunk,
            chunkIndex: i,
            totalChunks: chunks.length,
            embeddedAt: new Date().toISOString()
          }
        });
      }

      // Store in vector database
      await this.vectorService.upsert(vectors);

      return {
        success: true,
        data: {
          chunksProcessed: chunks.length,
          vectorsStored: vectors.length,
          documentId: metadata?.id
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  // ============================================================================
  // Learning Operations
  // ============================================================================

  private async learnFromText(task: AgentTask): Promise<TaskResult> {
    if (!this.selfLearningService) {
      return { success: false, error: 'Self-learning service not available' };
    }

    const { text, metadata } = task.payload;

    try {
      const result = await this.selfLearningService.learnFromText(text, metadata);

      return {
        success: true,
        data: {
          message: result,
          learnedAt: new Date().toISOString()
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async answerQuestion(task: AgentTask): Promise<TaskResult> {
    if (!this.selfLearningService) {
      return { success: false, error: 'Self-learning service not available' };
    }

    const { question } = task.payload;

    try {
      const result = await this.selfLearningService.answerQuestion(question);

      return {
        success: true,
        data: {
          question,
          answer: result.answer,
          sources: result.sources,
          confidence: result.confidence,
          processingTime: result.processingTime
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async getLearningHistory(task: AgentTask): Promise<TaskResult> {
    if (!this.selfLearningService) {
      return { success: false, error: 'Self-learning service not available' };
    }

    const { limit } = task.payload;

    try {
      const history = await this.selfLearningService.getLearningHistory(limit || 50);

      return {
        success: true,
        data: {
          history,
          totalSessions: history.length
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async provideFeedback(task: AgentTask): Promise<TaskResult> {
    if (!this.selfLearningService) {
      return { success: false, error: 'Self-learning service not available' };
    }

    const { sessionId, rating, comments } = task.payload;

    try {
      await this.selfLearningService.provideFeedback(sessionId, {
        rating,
        comments
      });

      return {
        success: true,
        data: {
          sessionId,
          feedbackRecorded: true
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private chunkText(text: string, chunkSize: number): string[] {
    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      let end = start + chunkSize;

      // Try to break at sentence boundaries
      if (end < text.length) {
        const lastPeriod = text.lastIndexOf('.', end);
        const lastNewline = text.lastIndexOf('\n', end);

        if (lastPeriod > start && lastPeriod > lastNewline) {
          end = lastPeriod + 1;
        } else if (lastNewline > start) {
          end = lastNewline + 1;
        }
      }

      chunks.push(text.slice(start, end).trim());
      start = end;
    }

    return chunks.filter(chunk => chunk.length > 0);
  }

  protected override generateId(): string {
    return `doc-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }
}
