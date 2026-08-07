/**
 * 上下文压缩模块（平台无关）
 */

export type { CompressionConfig, CompressionResult, CompressionLogger, CompressionLlmAdapter } from './types'
export { DEFAULT_CONTEXT_COMPRESSION_CONFIG } from './types'
export { checkAndCompress, manualCompress } from './compressor'
export { createCompressionLlmAdapter, type CreateCompressionLlmAdapterOptions } from './adapter-factory'
