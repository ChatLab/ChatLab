/**
 * LLM service type definitions
 */

/**
 * Supported LLM providers
 */
export type LLMProvider = 'deepseek' | 'qwen' | 'minimax' | 'glm' | 'kimi' | 'gemini' | 'doubao' | 'openai-compatible'

/**
 * Provider information
 */
export interface ProviderInfo {
  id: LLMProvider
  name: string
  description: string
  defaultBaseUrl: string
  models: Array<{
    id: string
    name: string
    description?: string
  }>
}

// ==================== Multi-config management types ====================

/**
 * Single AI service configuration
 */
export interface AIServiceConfig {
  id: string // UUID
  name: string // User-defined name
  provider: LLMProvider
  apiKey: string // May be empty (local API scenarios)
  model?: string
  baseUrl?: string // Custom endpoint
  maxTokens?: number
  /** Disable thinking mode (for local services like Qwen3, DeepSeek-R1, etc.) */
  disableThinking?: boolean
  /**
   * Mark as reasoning model (e.g., DeepSeek-R1, QwQ)
   * Reasoning models use extractReasoningMiddleware and don't support tool-calling
   */
  isReasoningModel?: boolean
  createdAt: number // Creation timestamp
  updatedAt: number // Update timestamp
}

/**
 * AI config storage structure
 */
export interface AIConfigStore {
  configs: AIServiceConfig[]
  activeConfigId: string | null
}

/**
 * Maximum number of configs allowed
 */
export const MAX_CONFIG_COUNT = 10
