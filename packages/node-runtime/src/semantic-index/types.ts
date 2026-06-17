/**
 * 语义索引存储核心类型
 *
 * embedding_index.db 是独立的系统级向量索引库，保存所有已启用对话的 child chunk
 * 向量与元数据。设计依据见 .docs/tasks/chunking/chunking-decision-final.md 第 8/11/17 节。
 */

/** chunk 索引状态 */
export type ChunkStatus = 'indexed' | 'pending' | 'failed'

/**
 * 单个 child chunk 的元数据记录（不含向量本身）。
 * 字段对应设计文档第 8 节"每个 chunk 至少记录"。
 */
export interface ChunkRecord {
  chunkId: string
  dbPathHash: string
  strategyId: string
  modelId: string
  dim: number
  parentId: string
  startMessageId: number
  endMessageId: number
  startTs: number
  endTs: number
  messageCount: number
  rawContentHash: string
  embeddingInputHash: string
  chunkerVersion: string
  chunkerConfigHash: string
  indexedAt: number
  status: ChunkStatus
}

/** 写入存储时的 chunk + 向量 */
export interface ChunkInsert {
  record: ChunkRecord
  /** 长度必须等于 record.dim */
  embedding: Float32Array | number[]
}

/** dense ANN 查询参数（始终限定单对话 + 单模型，命中分区裁剪） */
export interface DenseQueryParams {
  dbPathHash: string
  modelId: string
  dim: number
  embedding: Float32Array | number[]
  /** 取回数量，对应设计默认 dense topN=40 */
  k: number
}

/** dense ANN 查询单条结果 */
export interface DenseQueryResult {
  chunkId: string
  /** cosine 距离，越小越相关 */
  distance: number
  record: ChunkRecord
}

/** message_id -> chunk 范围映射参数 */
export interface MessageToChunkParams {
  dbPathHash: string
  modelId: string
  strategyId: string
  messageId: number
}
