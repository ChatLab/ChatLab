/**
 * 混合检索：dense（向量）+ FTS（全文）+ RRF 融合
 *
 * chunking-decision-final.md 第 10 节：
 * - dense：query 向量化后在 embedding_index.db 做 ANN，限定单对话 + 单模型分区。
 * - FTS：在聊天库做全文检索得到 message_id 排序，再用 store.mapMessageToChunk 映射到 chunk。
 * - 两路各自独立排序，Node 层 RRF 融合，取 finalTopK。
 *
 * FTS 来源（聊天库连接 + 分词）由注入的 FtsSearcher 提供，保持本模块平台无关、可单测。
 */

import type { EmbeddingProvider } from '../embedding/types'
import type { EmbeddingIndexStore } from '../store'
import type { ChunkRecord } from '../types'
import { reciprocalRankFusion } from './rrf'

/** 聊天库全文检索：返回按相关度排序的 message_id（最相关在前） */
export interface FtsSearcher {
  search(query: string, topN: number): number[]
}

export interface HybridSearchDeps {
  embedder: EmbeddingProvider
  store: EmbeddingIndexStore
  fts: FtsSearcher
}

export interface HybridSearchParams {
  query: string
  dbPathHash: string
  modelId: string
  strategyId: string
  dim: number
  /** dense 取回数量，默认 40 */
  denseTopN?: number
  /** FTS 取回 message 数量，默认 40 */
  ftsTopN?: number
  /** RRF 常数，默认 60 */
  rrfK?: number
  /** 融合后最终返回数量，默认 5 */
  finalTopK?: number
}

export interface HybridSearchResult {
  chunkId: string
  score: number
  record: ChunkRecord
  /** 在 dense 排序中的位次（0 最优），未命中为 null */
  denseRank: number | null
  /** 在 FTS 映射排序中的位次（0 最优），未命中为 null */
  ftsRank: number | null
}

export async function hybridSearch(deps: HybridSearchDeps, params: HybridSearchParams): Promise<HybridSearchResult[]> {
  const { embedder, store, fts } = deps
  const { query, dbPathHash, modelId, strategyId, dim, denseTopN = 40, ftsTopN = 40, rrfK = 60, finalTopK = 5 } = params

  if (!query.trim()) return []

  const records = new Map<string, ChunkRecord>()

  // dense
  const queryVector = await embedder.embedQuery(query)
  const dense = store.queryDense({ dbPathHash, modelId, dim, embedding: queryVector, k: denseTopN })
  const denseIds: string[] = []
  const denseRankById = new Map<string, number>()
  dense.forEach((hit, rank) => {
    denseIds.push(hit.chunkId)
    denseRankById.set(hit.chunkId, rank)
    records.set(hit.chunkId, hit.record)
  })

  // FTS message_id -> chunk（去重保序）
  const ftsIds: string[] = []
  const ftsRankById = new Map<string, number>()
  for (const messageId of fts.search(query, ftsTopN)) {
    const record = store.mapMessageToChunk({ dbPathHash, modelId, strategyId, messageId })
    if (!record || ftsRankById.has(record.chunkId)) continue
    ftsRankById.set(record.chunkId, ftsIds.length)
    ftsIds.push(record.chunkId)
    if (!records.has(record.chunkId)) records.set(record.chunkId, record)
  }

  const fused = reciprocalRankFusion([denseIds, ftsIds], rrfK)

  const results: HybridSearchResult[] = []
  for (const { id, score } of fused) {
    const record = records.get(id) ?? store.getChunkById(id)
    if (!record) continue
    results.push({
      chunkId: id,
      score,
      record,
      denseRank: denseRankById.get(id) ?? null,
      ftsRank: ftsRankById.get(id) ?? null,
    })
    if (results.length >= finalTopK) break
  }
  return results
}
