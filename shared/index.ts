/**
 * Shared Module Exports
 * Central export point for all shared services
 */

// Middleware
export {
  AIGuardrailsService,
  AuthMiddleware,
  GuardrailResult,
  RateLimitConfig,
  guardrails,
  auth
} from './middleware';

// Configuration
export {
  ConfigService,
  DatabaseConfig,
  RedisConfig,
  AIGatewayConfig,
  SecurityConfig,
  AgentConfig,
  SystemConfig,
  config
} from './config';

// Services
export {
  AIGateway,
  VectorService,
  RAGService,
  ChatMessage,
  ChatCompletionOptions,
  EmbeddingResult,
  VectorSearchResult,
  aiGateway,
  vectorService,
  ragService
} from './services';

// Storage
export {
  RedisStorage,
  StorageOptions,
  storage
} from './storage';
