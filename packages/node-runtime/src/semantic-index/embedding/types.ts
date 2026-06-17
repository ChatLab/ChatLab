/**
 * Embedding provider 统一接口与公共类型
 *
 * Phase 1 三个 provider：BGE（本地 ONNX）、Qwen3（本地 ONNX，batch=1）、
 * OpenAI-compatible API。检索时 query 与 document 分别走 embedQuery / embedDocuments，
 * 本地模型对 query 加 queryInstruction，document 不加。
 */

export type EmbeddingPooling = 'cls' | 'last_token' | 'mean'

export interface EmbeddingProvider {
  /** 用于 chunk 分区与重建判定的稳定模型标识 */
  readonly modelId: string
  /** 向量维度；API provider 在首次调用前可能为 0（未知） */
  readonly dim: number
  /** 单文本 token 上限（profile cap） */
  readonly maxTokens: number
  /** document 向量化（可批量；Qwen3 内部固定逐条） */
  embedDocuments(texts: string[]): Promise<Float32Array[]>
  /** query 向量化（本地模型会加 queryInstruction） */
  embedQuery(text: string): Promise<Float32Array>
}
