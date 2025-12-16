/**
 * Cloudflare Native AI Service
 * Uses ONLY Cloudflare Workers AI - NO external API dependencies
 *
 * This service demonstrates 100% Cloudflare-native AI capabilities
 */

import { Context } from 'hono';
import { ZAgentError, ErrorType } from '../types/core.js';

/**
 * Cloudflare AI Model Categories
 */
export enum ModelCategory {
  TEXT_GENERATION = 'text-generation',
  TEXT_CLASSIFICATION = 'text-classification',
  TRANSLATION = 'translation',
  EMBEDDINGS = 'embeddings',
  IMAGE_CLASSIFICATION = 'image-classification',
  TEXT_TO_IMAGE = 'text-to-image',
  AUTOMATIC_SPEECH_RECOGNITION = 'automatic-speech-recognition',
}

/**
 * Available Cloudflare AI Models
 * These run natively on Cloudflare's infrastructure
 */
export const CF_NATIVE_MODELS = {
  // Text Generation (Chat/Completion)
  LLAMA_2_7B: '@cf/meta/llama-2-7b-chat-fp16',
  LLAMA_2_7B_FP32: '@cf/meta/llama-2-7b-chat-fp32',
  LLAMA_3_8B: '@cf/meta/llama-3-8b-instruct',
  MISTRAL_7B: '@cf/mistral/mistral-7b-instruct-v0.1',
  QWEN_14B: '@cf/qwen/qwen1.5-14b-chat-awq',

  // Embeddings
  BGE_BASE: '@cf/baai/bge-base-en-v1.5',
  BGE_LARGE: '@cf/baai/bge-large-en-v1.5',
  BGE_SMALL: '@cf/baai/bge-small-en-v1.5',

  // Translation
  M2M100: '@cf/meta/m2m100-1.2b',

  // Image Generation
  STABLE_DIFFUSION: '@cf/stabilityai/stable-diffusion-xl-base-1.0',

  // Speech Recognition
  WHISPER: '@cf/openai/whisper',
} as const;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionRequest {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface EmbeddingRequest {
  text: string | string[];
  model?: string;
}

export interface ImageGenerationRequest {
  prompt: string;
  num_steps?: number;
  guidance?: number;
}

/**
 * CloudflareNativeAI Service
 * Uses ONLY Cloudflare Workers AI - completely API-independent
 */
export class CloudflareNativeAI {
  private ai: Ai;
  private defaultChatModel: string;
  private defaultEmbeddingModel: string;

  constructor(ai: Ai, config?: {
    defaultChatModel?: string;
    defaultEmbeddingModel?: string;
  }) {
    this.ai = ai;
    this.defaultChatModel = config?.defaultChatModel || CF_NATIVE_MODELS.LLAMA_3_8B;
    this.defaultEmbeddingModel = config?.defaultEmbeddingModel || CF_NATIVE_MODELS.BGE_BASE;
  }

  /**
   * Chat completion using Cloudflare's LLMs
   * NO EXTERNAL API CALLS
   */
  async chat(request: ChatCompletionRequest): Promise<{
    response: string;
    model: string;
    tokensUsed?: number;
  }> {
    try {
      const model = request.model || this.defaultChatModel;

      const result = await this.ai.run(model, {
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.max_tokens,
        stream: request.stream || false,
      });

      // Type assertion for the result
      const response = result as { response: string };

      return {
        response: response.response,
        model,
      };
    } catch (error) {
      throw new ZAgentError(
        ErrorType.EXTERNAL_SERVICE,
        `Cloudflare AI error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500,
        { model: request.model }
      );
    }
  }

  /**
   * Generate embeddings using Cloudflare's embedding models
   * Used for RAG, semantic search, etc.
   */
  async generateEmbedding(request: EmbeddingRequest): Promise<{
    embeddings: number[][];
    model: string;
  }> {
    try {
      const model = request.model || this.defaultEmbeddingModel;
      const texts = Array.isArray(request.text) ? request.text : [request.text];

      const embeddings: number[][] = [];

      for (const text of texts) {
        const result = await this.ai.run(model, {
          text,
        });

        // Type assertion for embedding result
        const embedding = result as { data: number[][] };
        const embeddingData = embedding.data?.[0];
        if (embeddingData) {
          embeddings.push(embeddingData);
        }
      }

      return {
        embeddings,
        model,
      };
    } catch (error) {
      throw new ZAgentError(
        ErrorType.EXTERNAL_SERVICE,
        `Cloudflare embedding error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500
      );
    }
  }

  /**
   * Generate images using Cloudflare's Stable Diffusion
   */
  async generateImage(request: ImageGenerationRequest): Promise<{
    image: ArrayBuffer;
    model: string;
  }> {
    try {
      const result = await this.ai.run(CF_NATIVE_MODELS.STABLE_DIFFUSION, {
        prompt: request.prompt,
        num_steps: request.num_steps || 20,
        guidance: request.guidance || 7.5,
      });

      // Type assertion for image result
      const imageResult = result as ArrayBuffer;

      return {
        image: imageResult,
        model: CF_NATIVE_MODELS.STABLE_DIFFUSION,
      };
    } catch (error) {
      throw new ZAgentError(
        ErrorType.EXTERNAL_SERVICE,
        `Cloudflare image generation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500
      );
    }
  }

  /**
   * Translate text using Cloudflare's translation models
   */
  async translate(text: string, sourceLang: string, targetLang: string): Promise<{
    translation: string;
    model: string;
  }> {
    try {
      const result = await this.ai.run(CF_NATIVE_MODELS.M2M100, {
        text,
        source_lang: sourceLang,
        target_lang: targetLang,
      });

      // Type assertion for translation result
      const translation = result as { translated_text: string };

      return {
        translation: translation.translated_text,
        model: CF_NATIVE_MODELS.M2M100,
      };
    } catch (error) {
      throw new ZAgentError(
        ErrorType.EXTERNAL_SERVICE,
        `Cloudflare translation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500
      );
    }
  }

  /**
   * Transcribe audio using Cloudflare's Whisper
   */
  async transcribe(audio: ArrayBuffer): Promise<{
    text: string;
    model: string;
  }> {
    try {
      const result = await this.ai.run(CF_NATIVE_MODELS.WHISPER, {
        audio,
      });

      // Type assertion for transcription result
      const transcription = result as { text: string };

      return {
        text: transcription.text,
        model: CF_NATIVE_MODELS.WHISPER,
      };
    } catch (error) {
      throw new ZAgentError(
        ErrorType.EXTERNAL_SERVICE,
        `Cloudflare transcription error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500
      );
    }
  }

  /**
   * Get available models
   */
  getAvailableModels(): typeof CF_NATIVE_MODELS {
    return CF_NATIVE_MODELS;
  }
}

/**
 * Initialize Cloudflare Native AI middleware
 */
export const initializeCloudflareAI = async (
  c: Context,
  next: () => Promise<void>
): Promise<void> => {
  // Get the AI binding from Cloudflare Workers
  const ai = c.env?.AI as Ai;

  if (!ai) {
    throw new ZAgentError(
      ErrorType.INTERNAL,
      'AI binding not available - ensure [ai] binding is configured in wrangler.toml',
      500
    );
  }

  // Initialize the service
  const cfAI = new CloudflareNativeAI(ai, {
    defaultChatModel: c.env?.DEFAULT_CHAT_MODEL as string | undefined,
    defaultEmbeddingModel: c.env?.DEFAULT_EMBEDDING_MODEL as string | undefined,
  });

  // Add to context
  c.set('cfAI', cfAI);

  await next();
};
