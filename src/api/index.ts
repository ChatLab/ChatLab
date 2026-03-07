/**
 * Frontend API client — re-exports all domain-specific API modules.
 *
 * Usage:
 *   import { chatApi, aiApi, llmApi, agentApi } from '@/api'
 *
 * These modules replace the Electron preload `window.*Api` globals
 * with HTTP/SSE calls to the Express backend.
 */

export { chatApi } from './chat'
export { aiApi } from './ai'
export { llmApi } from './llm'
export { agentApi } from './agent'
export { embeddingApi } from './embedding'
export { nlpApi } from './nlp'
export { networkApi } from './network'
export { cacheApi } from './cache'
export { sessionApi } from './session-index'
export { mergeApi, migrationApi } from './merge'

// Re-export the base client utilities for advanced use
export { setBaseUrl, getBaseUrl, ApiError } from './client'

// Re-export commonly-used types
export type { SearchMessageResult, AIConversation, AIMessage, ContentBlock, DesensitizeRule } from './ai'
export type { LLMProvider, AIServiceConfigDisplay, ChatMessage, ChatOptions, ChatStreamChunk } from './llm'
export type {
  AgentStreamChunk,
  AgentResult,
  AgentRuntimeStatus,
  TokenUsage,
  ToolContext,
  PromptConfig,
  PreprocessConfig,
} from './agent'
export type { EmbeddingServiceConfig, EmbeddingServiceConfigDisplay } from './embedding'
export type { WordFrequencyParams, WordFrequencyResult, WordFrequencyItem, PosTagInfo, PosFilterMode } from './nlp'
export type { ProxyConfig, ProxyMode } from './network'
export type { CacheInfo, CacheDirectoryInfo, DataDirInfo } from './cache'
export type { SessionStats, ChatSessionItem } from './session-index'
