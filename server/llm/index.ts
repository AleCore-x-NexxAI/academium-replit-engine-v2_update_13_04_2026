/**
 * LLM Module - Unified provider abstraction
 * 
 * This module provides a single interface for both OpenAI and Gemini providers
 * with automatic failover, retry logic, and rate limiting.
 */

export {
  generateChatCompletion,
  isRateLimitError,
  getProviderStats,
  openai,
  gemini,
  type ChatMessage,
  type CompletionOptions,
  type ProviderType,
  type SupportedModel,
  type OpenAIModel,
  type GeminiModel,
  type ProviderStats,
  OPENAI_MODELS,
  GEMINI_MODELS,
} from "./provider";
