/**
 * Data Embedding Service for Knowledge Base
 * Implements functionality for embedding various types of data into the knowledge base
 */

import { Context } from 'hono';
import { AIGateway } from '../shared/services.js';

export interface EmbeddingConfig {
  maxChunkSize: number;
  overlapSize: number;
  embeddingModel: string;
}

export interface Document {
  id: string;
  content: string;
  metadata?: Record<string, any>;
  embedding?: number[];
}

export interface TimeSeriesData {
  id: string;
  data: Array<{ timestamp: string; value: number }>;
 metadata?: Record<string, any>;
}

export interface EmbeddingResult {
  id: string;
  success: boolean;
 message?: string;
}

export class DataEmbeddingService {
  private aiGateway: AIGateway;
  private config: EmbeddingConfig;

  constructor(aiGateway: AIGateway, config: EmbeddingConfig) {
    this.aiGateway = aiGateway;
    this.config = config;
  }

  /**
   * Embeds a document into the knowledge base
   */
  async embedDocument(document: Document): Promise<EmbeddingResult> {
    try {
      // Validate document
      if (!document.id || !document.content) {
        return {
          id: document.id,
          success: false,
          message: 'Document ID and content are required'
        };
      }

      // Chunk the document if it's too large
      const chunks = this.chunkDocument(document.content);
      
      // Process each chunk
      for (let i = 0; i < chunks.length; i++) {
        const chunkId = `${document.id}_chunk_${i}`;
        const chunk = chunks[i];
        if (chunk) {
          const embedding = await this.generateEmbedding(chunk);
          
          // Store the embedding in Cloudflare Vectorize
          await this.storeEmbedding(chunkId, embedding, {
            ...document.metadata,
            chunk_index: i,
            total_chunks: chunks.length,
            original_id: document.id,
            source_type: 'document',
            text: chunk // Store the actual text for retrieval
          });
        }
      }

      return {
        id: document.id,
        success: true,
        message: `Successfully embedded document with ${chunks.length} chunks`
      };
    } catch (error: any) {
      return {
        id: document.id,
        success: false,
        message: `Failed to embed document: ${error.message}`
      };
    }
  }

  /**
   * Embeds time series data into the knowledge base
   */
  async embedTimeSeriesData(data: TimeSeriesData): Promise<EmbeddingResult> {
    try {
      if (!data.id || !data.data || data.data.length === 0) {
        return {
          id: data.id,
          success: false,
          message: 'Time series data ID and data array are required'
        };
      }

      // Convert time series data to text representation
      const textRepresentation = this.convertTimeSeriesToText(data);
      const embedding = await this.generateEmbedding(textRepresentation);
      
      // Store the embedding
      await this.storeEmbedding(data.id, embedding, {
        ...data.metadata,
        data_type: 'time_series',
        start_time: data.data[0]?.timestamp,
        end_time: data.data[data.data.length - 1]?.timestamp,
        data_points: data.data.length,
        source_type: 'time_series'
      });

      return {
        id: data.id,
        success: true,
        message: 'Successfully embedded time series data'
      };
    } catch (error: any) {
      return {
        id: data.id,
        success: false,
        message: `Failed to embed time series data: ${error.message}`
      };
    }
 }

  /**
   * Embeds structured data (JSON objects) into the knowledge base
   */
  async embedStructuredData(data: any, id: string, metadata?: Record<string, any>): Promise<EmbeddingResult> {
    try {
      if (!id || !data) {
        return {
          id,
          success: false,
          message: 'ID and data are required'
        };
      }

      // Convert structured data to text
      const textRepresentation = this.convertStructuredDataToText(data);
      const embedding = await this.generateEmbedding(textRepresentation);
      
      // Store the embedding
      await this.storeEmbedding(id, embedding, {
        ...metadata,
        data_type: 'structured',
        original_data_type: typeof data,
        source_type: 'structured_data'
      });

      return {
        id,
        success: true,
        message: 'Successfully embedded structured data'
      };
    } catch (error: any) {
      return {
        id,
        success: false,
        message: `Failed to embed structured data: ${error.message}`
      };
    }
 }

  /**
   * Chunks a document into smaller pieces
   */
  private chunkDocument(content: string): string[] {
    const words = content.split(/\s+/);
    const chunks: string[] = [];
    let currentChunk: string[] = [];

    for (const word of words) {
      if (currentChunk.join(' ').length + word.length + 1 > this.config.maxChunkSize && currentChunk.length > 0) {
        // If adding the next word would exceed the chunk size, save the current chunk
        chunks.push(currentChunk.join(' '));
        
        // Start a new chunk with some overlap from the previous chunk
        const overlapWords = currentChunk.slice(-this.config.overlapSize);
        currentChunk = [...overlapWords, word];
      } else {
        currentChunk.push(word);
      }
    }

    // Add the last chunk if it has content
    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join(' '));
    }

    return chunks;
  }

  /**
   * Converts time series data to text representation
   */
 private convertTimeSeriesToText(data: TimeSeriesData): string {
    if (!data.data || data.data.length === 0) {
      return 'Empty time series data';
    }
    
    const dataPoints = data.data.slice(0, 100); // Limit to first 100 points to prevent overly large embeddings
    const text = `Time series data with ${data.data.length} points from ${data.data[0]?.timestamp} to ${data.data[data.data.length - 1]?.timestamp}. `;
    
    // Add summary statistics
    const values = dataPoints.map(d => d.value);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);
    
    return text + `Summary: Average=${avg.toFixed(2)}, Min=${min}, Max=${max}, First few values: ${values.slice(0, 5).join(', ')}`;
  }

  /**
   * Converts structured data to text representation
   */
  private convertStructuredDataToText(data: any): string {
    if (typeof data === 'string') return data;
    
    // Convert structured data (JSON, objects, arrays) to text
    if (typeof data === 'object') {
      return JSON.stringify(data, null, 2);
    }
    
    return String(data);
  }

  /**
   * Generates embedding for text content
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      // In a real implementation, this would call an embedding model
      // For now, we'll return a placeholder
      const result = await this.aiGateway.requestModel(
        this.config.embeddingModel,
        { text: text.substring(0, 2000) }, // Limit text length
      );
      
      // Return the embedding from the result
      return result.embedding || result.data?.embedding || [];
    } catch (error) {
      console.error('Failed to generate embedding:', error);
      // If the embedding model is not available, return a simple hash-based vector
      return this.textToVector(text);
    }
  }

  /**
   * Simple text to vector conversion (fallback)
   */
  private textToVector(text: string): number[] {
    const vector: number[] = new Array(384).fill(0); // Typical size for embedding vectors
    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i);
      const index = i % vector.length;
      if (vector[index] !== undefined) {
        vector[index] = (vector[index] + charCode) % 1;
      }
    }
    return vector;
  }

  /**
   * Stores embedding in the knowledge base (placeholder implementation)
   */
  private async storeEmbedding(id: string, embedding: number[], metadata: Record<string, any>): Promise<void> {
    try {
      // Get Cloudflare credentials from environment
      const accountId = process.env.CF_ACCOUNT_ID;
      const apiToken = process.env.CF_API_TOKEN;
      const indexName = process.env.AUTORAG_VECTOR_INDEX || 'system-knowledge-base';

      if (!accountId || !apiToken) {
        console.error('Cloudflare credentials not configured for vector storage');
        return;
      }

      // Upsert vector to Cloudflare Vectorize
      const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/vectorize/indexes/${indexName}/upsert`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          vectors: [{
            id,
            values: embedding,
            metadata
          }]
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Vector upsert failed: ${error}`);
      }

      const result = await response.json();
      console.log(`✅ Stored embedding for ${id} with ${embedding.length} dimensions in ${indexName}. Inserted: ${result.result?.count || 1}`);
    } catch (error) {
      console.error(`Failed to store embedding for ${id}:`, error);
      throw error;
    }
  }
}

/**
 * Initialize data embedding service
 */
export const initializeDataEmbedding = async (c: Context, next: () => Promise<void>) => {
  const aiGateway = c.get('aiGateway');
  
  if (!aiGateway) {
    return c.json(
      { error: 'AI Gateway required for data embedding service' },
      500
    );
  }

  const embeddingConfig = {
    maxChunkSize: parseInt(c.env?.KB_MAX_CHUNK_SIZE || process.env.KB_MAX_CHUNK_SIZE || '1000'),
    overlapSize: parseInt(c.env?.KB_OVERLAP_SIZE || process.env.KB_OVERLAP_SIZE || '100'),
    embeddingModel: c.env?.KB_EMBEDDING_MODEL || process.env.KB_EMBEDDING_MODEL || '@cf/baai/bge-large-en-v1.5',
  };

  const dataEmbeddingService = new DataEmbeddingService(aiGateway, embeddingConfig);
  c.set('dataEmbeddingService', dataEmbeddingService);
  
  await next();
};