export interface CompressionConfig {
  /** 触发压缩的 token 阈值百分比（相对于 context window），默认 75 */
  tokenThresholdPercent: number
  /** 保留最近消息的缓冲区大小（相对于 context window 的百分比），默认 20 */
  bufferSizePercent: number
  /** 单次工具返回的最大上下文占比（相对于 context window 的百分比），默认 50 */
  maxToolResultPercent?: number
}

export const DEFAULT_CONTEXT_COMPRESSION_CONFIG: Readonly<CompressionConfig> = Object.freeze({
  tokenThresholdPercent: 75,
  bufferSizePercent: 20,
  maxToolResultPercent: 50,
})

export interface CompressionResult {
  compressed: boolean
  reason: 'skipped_below_threshold' | 'skipped_idempotent' | 'success' | 'fallback_truncated' | 'thrashing' | 'error'
  tokensBefore?: number
  tokensAfter?: number
  summaryContent?: string
  error?: string
}

export interface CompressionLogger {
  info(category: string, message: string, extra?: Record<string, unknown>): void
  warn(category: string, message: string, extra?: Record<string, unknown>): void
  error(category: string, message: string, extra?: Record<string, unknown>): void
}

/**
 * 抽象 LLM 压缩调用接口。
 * 平台侧提供具体实现（使用 pi-ai 的 completeSimple 等）。
 */
export interface CompressionLlmAdapter {
  /**
   * 调用 LLM 进行压缩，返回压缩后的文本，失败返回 null。
   */
  compress(prompt: string, maxTokens: number): Promise<string | null>
  /** 解析模型的 context window 大小 */
  contextWindow: number
}
