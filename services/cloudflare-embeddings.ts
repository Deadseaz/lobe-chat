/**
 * Cloudflare AI Embeddings Service
 * Uses Cloudflare Workers AI for generating embeddings (NO OpenAI)
 */

export interface EmbeddingResult {
  embedding: number[];
  text: string;
}

export class CloudflareEmbeddingsService {
  private ai: any; // Cloudflare AI binding
  private model: string;

  constructor(ai: any, model: string = '@cf/baai/bge-base-en-v1.5') {
    this.ai = ai;
    this.model = model; // Default to BGE model (768 dimensions)
  }

  /**
   * Generate embeddings for a single text
   */
  async generateEmbedding(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      throw new Error('Text cannot be empty');
    }

    try {
      const response = await this.ai.run(this.model, {
        text: [text]
      });

      if (!response || !response.data || !response.data[0]) {
        throw new Error('Invalid response from Cloudflare AI');
      }

      return response.data[0];
    } catch (error) {
      console.error('Failed to generate embedding:', error);
      throw new Error(`Embedding generation failed: ${(error as Error).message}`);
    }
  }

  /**
   * Generate embeddings for multiple texts (batch)
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) {
      return [];
    }

    // Filter out empty texts
    const validTexts = texts.filter(t => t && t.trim().length > 0);

    if (validTexts.length === 0) {
      return [];
    }

    try {
      // Cloudflare AI supports batching
      const response = await this.ai.run(this.model, {
        text: validTexts
      });

      if (!response || !response.data) {
        throw new Error('Invalid response from Cloudflare AI');
      }

      return response.data;
    } catch (error) {
      console.error('Failed to generate embeddings:', error);
      throw new Error(`Batch embedding generation failed: ${(error as Error).message}`);
    }
  }

  /**
   * Get the embedding model being used
   */
  getModel(): string {
    return this.model;
  }

  /**
   * Get the dimension of embeddings produced by this model
   */
  getDimensions(): number {
    // BGE Base model produces 768-dimensional embeddings
    // If using other models, adjust accordingly:
    // - @cf/baai/bge-small-en-v1.5: 384 dimensions
    // - @cf/baai/bge-large-en-v1.5: 1024 dimensions
    switch (this.model) {
      case '@cf/baai/bge-small-en-v1.5':
        return 384;
      case '@cf/baai/bge-large-en-v1.5':
        return 1024;
      case '@cf/baai/bge-base-en-v1.5':
      default:
        return 768;
    }
  }

  /**
   * Calculate cosine similarity between two embeddings
   */
  cosineSimilarity(embeddingA: number[], embeddingB: number[]): number {
    if (embeddingA.length !== embeddingB.length) {
      throw new Error('Embeddings must have the same dimensions');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < embeddingA.length; i++) {
      dotProduct += embeddingA[i] * embeddingB[i];
      normA += embeddingA[i] * embeddingA[i];
      normB += embeddingB[i] * embeddingB[i];
    }

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
