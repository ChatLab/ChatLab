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

/** 聊天库全文检索：返回按相关度排序的消息（最相关在前）；ts 为毫秒，与 chunk_vector_index 的 startTs/endTs 单位一致 */
export interface FtsSearcher {
  search(query: string, topN: number): Array<{ id: number; ts: number }>
}

export interface HybridSearchDeps {
  embedder: EmbeddingProvider
  store: EmbeddingIndexStore
  fts: FtsSearcher
}

/** 毫秒级、可单边的时间区间（语义 chunk startTs/endTs 也是毫秒） */
export interface SemanticTimeRangeMs {
  startTs?: number
  endTs?: number
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
  /**
   * 毫秒级时间范围过滤（可单边）。
   * 只保留与 chunk [startTs, endTs] 有交集的候选；启用时会放大候选池避免过滤后结果过少。
   */
  timeRangeMs?: SemanticTimeRangeMs
}

/** chunk 时间范围是否与过滤区间有交集 */
function overlapsTimeRangeMs(record: ChunkRecord, filter?: SemanticTimeRangeMs): boolean {
  if (!filter) return true
  if (filter.startTs != null && record.endTs < filter.startTs) return false
  if (filter.endTs != null && record.startTs > filter.endTs) return false
  return true
}

/** 启用时间过滤时放大候选池的倍数；必须足够大，避免长对话中窄时间段的 in-range chunk 均排在 top-N 以外 */
const TIME_FILTER_POOL_MULTIPLIER = 10

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
  const { query, dbPathHash, modelId, strategyId, dim, rrfK = 60, finalTopK = 5, timeRangeMs } = params

  if (!query.trim()) return []

  // 启用时间过滤时放大候选池，避免过滤后融合结果过少
  const poolFactor = timeRangeMs ? TIME_FILTER_POOL_MULTIPLIER : 1
  const denseTopN = Math.max((params.denseTopN ?? 40) * poolFactor, 40)
  const ftsTopN = Math.max((params.ftsTopN ?? 40) * poolFactor, 40)

  const records = new Map<string, ChunkRecord>()

  // dense（按时间交集过滤后顺序构造排名）
  const queryVector = await embedder.embedQuery(query)
  const dense = store.queryDense({ dbPathHash, modelId, dim, embedding: queryVector, k: denseTopN })
  const denseIds: string[] = []
  const denseRankById = new Map<string, number>()
  for (const hit of dense) {
    if (!overlapsTimeRangeMs(hit.record, timeRangeMs)) continue
    denseRankById.set(hit.chunkId, denseIds.length)
    denseIds.push(hit.chunkId)
    records.set(hit.chunkId, hit.record)
  }

  // FTS message -> chunk（按 ts 映射，去重保序 + 时间交集过滤）
  const ftsIds: string[] = []
  const ftsRankById = new Map<string, number>()
  for (const { id: messageId, ts: messageTs } of fts.search(query, ftsTopN)) {
    const record = store.mapMessageToChunk({ dbPathHash, modelId, strategyId, messageId, messageTs })
    if (!record || ftsRankById.has(record.chunkId)) continue
    if (!overlapsTimeRangeMs(record, timeRangeMs)) continue
    ftsRankById.set(record.chunkId, ftsIds.length)
    ftsIds.push(record.chunkId)
    if (!records.has(record.chunkId)) records.set(record.chunkId, record)
  }

  const fused = reciprocalRankFusion([denseIds, ftsIds], rrfK)

  const results: HybridSearchResult[] = []
  for (const { id, score } of fused) {
    const record = records.get(id) ?? store.getChunkById(id)
    if (!record) continue
    // 兜底：getChunkById 取回的候选也按时间过滤
    if (!overlapsTimeRangeMs(record, timeRangeMs)) continue
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
