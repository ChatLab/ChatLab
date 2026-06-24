/**
 * Embedding provider 统一接口与公共类型
 *
 * 两类 provider：Qwen3（本地 ONNX，batch=1）与 OpenAI-compatible API。
 * 检索时 query 与 document 分别走 embedQuery / embedDocuments，
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
  /** warmup 建索引时推荐的 document 批量大小；未声明时按 1 条处理 */
  readonly documentBatchSize?: number
  /** document 向量化（可批量；Qwen3 内部固定逐条） */
  embedDocuments(texts: string[]): Promise<Float32Array[]>
  /** query 向量化（本地模型会加 queryInstruction） */
  embedQuery(text: string): Promise<Float32Array>
  /** 预热：触发模型下载/加载而不做实际 embedding。API provider 为 no-op。 */
  preload?(): Promise<void>
}
