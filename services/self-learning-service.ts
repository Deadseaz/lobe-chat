import { Context } from 'hono';
import { AIGatewayService } from './ai-gateway-service';
import { VectorService } from './vector-service';
import { ZeroTrustService } from './zero-trust-service';
import { D1Service } from './d1-service';

export interface RAGResult {
  answer: string;
  sources: any[];
  confidence: number;
  processingTime: number;
}

export interface LearningSession {
  id: string;
  question: string;
  answer: string;
  sources: any[];
  feedback?: {
    rating: number;
    comments?: string;
    timestamp: string;
  };
  created_at: string;
  updated_at: string;
}

export interface FeedbackData {
  sessionId: string;
  rating: number;
  comments?: string;
}

export class SelfLearningService {
  private aiGateway: AIGatewayService;
  private vectorService: VectorService;
  private zeroTrust: ZeroTrustService;
  private d1Service: D1Service;
  private tableName: string;

  constructor(ai: AIGatewayService, vs: VectorService, zt: ZeroTrustService, d1: D1Service, tableName: string = 'learning_sessions') {
    this.aiGateway = ai;
    this.vectorService = vs;
    this.zeroTrust = zt;
    this.d1Service = d1;
    this.tableName = tableName;
    this.initializeTable();
  }

  private async initializeTable(): Promise<void> {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id TEXT PRIMARY KEY,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        sources TEXT NOT NULL, -- JSON array
        feedback TEXT, -- JSON object
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_learning_sessions_created_at ON ${this.tableName}(created_at DESC);
    `;

    await this.d1Service.execute(createTableSQL);
  }

  async learnFromText(text: string, metadata: any = {}): Promise<string> {
    if (!this.zeroTrust.isPromptSafe(text)) {
      throw new Error('Potentially malicious content detected in learning text.');
    }

    const startTime = Date.now();

    try {
      // Chunk the text for better embedding (simple sentence-based chunking)
      const chunks = this.chunkText(text, 1000); // 1000 characters per chunk

      const vectors = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];

        // Get embedding for the chunk
        const embeddingResponse: any = await this.aiGateway.requestModel('@cf/baai/bge-large-en-v1.5', {
          text: chunk
        });

        if (!embeddingResponse.success || !embeddingResponse.result) {
          throw new Error('Failed to generate embedding for text chunk');
        }

        vectors.push({
          id: `${metadata.id || this.generateId()}_chunk_${i}`,
          embedding: embeddingResponse.result.data[0],
          metadata: {
            ...metadata,
            text: chunk,
            chunkIndex: i,
            totalChunks: chunks.length,
            originalText: text
          }
        });
      }

      // Store vectors in database
      await this.vectorService.upsert(vectors);

      const processingTime = Date.now() - startTime;

      return `Successfully learned from text (${chunks.length} chunks, ${processingTime}ms)`;

    } catch (error) {
      console.error('Error in learnFromText:', error);
      throw new Error(`Failed to learn from text: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async answerQuestion(question: string): Promise<RAGResult> {
    if (!this.zeroTrust.isPromptSafe(question)) {
      throw new Error('Potentially malicious content detected in question.');
    }

    const startTime = Date.now();

    try {
      // 1. Get embedding for the question
      const questionEmbeddingResponse: any = await this.aiGateway.requestModel('@cf/baai/bge-large-en-v1.5', {
        text: question
      });

      if (!questionEmbeddingResponse.success || !questionEmbeddingResponse.result) {
        throw new Error('Failed to generate embedding for question');
      }

      // 2. Query vector database for relevant documents
      const relevantDocs = await this.vectorService.query(questionEmbeddingResponse.result.data[0], 5);

      if (relevantDocs.length === 0) {
        return {
          answer: "I don't have enough information to answer this question. Please provide more context or learning materials.",
          sources: [],
          confidence: 0,
          processingTime: Date.now() - startTime
        };
      }

      // 3. Construct a prompt with the relevant documents as context
      const context = relevantDocs
        .map(doc => doc.vector.metadata['text'])
        .join('\n\n')
        .substring(0, 4000); // Limit context length

      const prompt = `You are a helpful AI assistant with access to the following knowledge base. Use this information to provide accurate, helpful answers. If the information doesn't contain enough context to fully answer the question, acknowledge this limitation.

Knowledge Base:
${context}

Question: ${question}

Please provide a clear, concise answer based on the knowledge base above. If the question cannot be fully answered with the available information, please state this clearly.`;

      // 4. Get the final answer from the AI model
      const response: any = await this.aiGateway.requestModel('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          {
            role: 'system',
            content: 'You are a knowledgeable AI assistant that provides accurate answers based on the provided knowledge base.'
          },
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      if (!response.success || !response.result) {
        throw new Error('Failed to generate answer from AI model');
      }

      const answer = response.result.response || 'Unable to generate answer';

      // Calculate confidence based on number of relevant sources and their scores
      const avgScore = relevantDocs.reduce((sum, doc) => sum + doc.score, 0) / relevantDocs.length;
      const confidence = Math.min(avgScore * 100, 100); // Convert to percentage

      const result: RAGResult = {
        answer,
        sources: relevantDocs.map(doc => ({
          ...doc.vector.metadata,
          score: doc.score
        })),
        confidence,
        processingTime: Date.now() - startTime
      };

      // Store the learning session
      await this.storeLearningSession({
        id: this.generateId(),
        question,
        answer,
        sources: result.sources
      });

      return result;

    } catch (error) {
      console.error('Error in answerQuestion:', error);
      throw new Error(`Failed to answer question: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async provideFeedback(sessionId: string, feedback: Omit<FeedbackData, 'sessionId'>): Promise<void> {
    const sql = `
      UPDATE ${this.tableName}
      SET feedback = ?, updated_at = ?
      WHERE id = ?
    `;

    const feedbackData = {
      rating: feedback.rating,
      comments: feedback.comments,
      timestamp: new Date().toISOString()
    };

    await this.d1Service.execute(sql, [
      JSON.stringify(feedbackData),
      new Date().toISOString(),
      sessionId
    ]);
  }

  async getLearningHistory(limit: number = 50): Promise<LearningSession[]> {
    const sql = `SELECT * FROM ${this.tableName} ORDER BY created_at DESC LIMIT ?`;
    const result = await this.d1Service.query(sql, [limit]);

    if (!result.success || !result.result) {
      return [];
    }

    return result.result.map((row: any) => ({
      id: row.id,
      question: row.question,
      answer: row.answer,
      sources: JSON.parse(row.sources),
      feedback: row.feedback ? JSON.parse(row.feedback) : undefined,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));
  }

  async getAnalytics(): Promise<{
    totalSessions: number;
    averageConfidence: number;
    averageFeedbackRating: number;
    totalSourcesUsed: number;
  }> {
    const sql = `
      SELECT
        COUNT(*) as total_sessions,
        AVG(CASE WHEN feedback IS NOT NULL THEN json_extract(feedback, '$.rating') END) as avg_feedback,
        SUM(json_array_length(sources)) as total_sources
      FROM ${this.tableName}
    `;

    const result = await this.d1Service.query(sql);

    if (!result.success || !result.result || result.result.length === 0) {
      return {
        totalSessions: 0,
        averageConfidence: 0,
        averageFeedbackRating: 0,
        totalSourcesUsed: 0
      };
    }

    const row = result.result[0];

    return {
      totalSessions: row.total_sessions || 0,
      averageConfidence: 0, // Would need to calculate from stored confidence values
      averageFeedbackRating: row.avg_feedback || 0,
      totalSourcesUsed: row.total_sources || 0
    };
  }

  private async storeLearningSession(session: Omit<LearningSession, 'created_at' | 'updated_at'>): Promise<void> {
    const sql = `
      INSERT INTO ${this.tableName} (id, question, answer, sources, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    const now = new Date().toISOString();

    await this.d1Service.execute(sql, [
      session.id,
      session.question,
      session.answer,
      JSON.stringify(session.sources),
      now,
      now
    ]);
  }

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

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }
}

export const initializeSelfLearningService = async (c: Context, next: () => Promise<void>): Promise<void> => {
    const aiGateway = c.get('aiGatewayService');
    const vectorService = c.get('vectorService');
    const zeroTrust = c.get('zeroTrustService');
    const d1Service = c.get('d1Service');

    if (!aiGateway || !vectorService || !zeroTrust || !d1Service) {
        c.status(500);
        c.json({ error: 'AI Gateway, Vector, Zero Trust, and D1 services are required.' });
        return;
    }

    const service = new SelfLearningService(aiGateway, vectorService, zeroTrust, d1Service);
    c.set('selfLearningService', service);
    await next();
};
