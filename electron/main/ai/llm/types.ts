/**
 * LLM 服务类型定义
 */

/**
 * 支持的 LLM 提供商
 */
export type LLMProvider = 'deepseek' | 'qwen' | 'minimax' | 'glm' | 'kimi' | 'gemini' | 'doubao' | 'openai-compatible'

/**
 * 提供商信息
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

// ==================== 多配置管理相关类型 ====================

/**
 * 单个 AI 服务配置
 */
export interface AIServiceConfig {
  id: string // UUID
  name: string // 用户自定义名称
  provider: LLMProvider
  apiKey: string // 可为空（本地 API 场景）
  model?: string
  baseUrl?: string // 自定义端点
  maxTokens?: number
  /** 禁用思考模式（用于本地服务，如 Qwen3、DeepSeek-R1 等） */
  disableThinking?: boolean
  /**
   * 标记为推理模型（如 DeepSeek-R1、QwQ 等）
   * 推理模型会使用 extractReasoningMiddleware 提取思考内容，且不支持 tool-calling
   */
  isReasoningModel?: boolean
  createdAt: number // 创建时间戳
  updatedAt: number // 更新时间戳
}

/**
 * AI 配置存储结构
 */
export interface AIConfigStore {
  configs: AIServiceConfig[]
  activeConfigId: string | null
}

/**
 * 最大配置数量限制
 */
export const MAX_CONFIG_COUNT = 99
