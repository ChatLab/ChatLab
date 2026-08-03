/** Dense semantic retrieval over the derived embedding index. */

import type { EmbeddingProvider } from '../embedding/types'
import type { EmbeddingIndexStore } from '../store'
import type { ChunkRecord } from '../types'

export interface SemanticSearchDeps {
  embedder: EmbeddingProvider
  store: EmbeddingIndexStore
}

/** Optional one-sided time range in milliseconds. */
export interface SemanticTimeRangeMs {
  startTs?: number
  endTs?: number
}

export interface SemanticSearchParams {
  query: string
  dbPathHash: string
  modelId: string
  dim: number
  /** Number of dense candidates to retrieve. Defaults to 40. */
  denseTopN?: number
  /** Maximum number of hits to return. Defaults to 5. */
  finalTopK?: number
  /**
   * Optional time range in milliseconds.
   * Keeps chunks that overlap the range and enlarges the candidate pool while filtering.
   */
  timeRangeMs?: SemanticTimeRangeMs
}

/** Whether a chunk overlaps the optional time range. */
function overlapsTimeRangeMs(record: ChunkRecord, filter?: SemanticTimeRangeMs): boolean {
  if (!filter) return true
  if (filter.startTs != null && record.endTs < filter.startTs) return false
  if (filter.endTs != null && record.startTs > filter.endTs) return false
  return true
}

/** Enlarges the candidate pool so narrow ranges in long chats still return in-range chunks. */
const TIME_FILTER_POOL_MULTIPLIER = 10

export interface SemanticSearchHit {
  chunkId: string
  score: number
  record: ChunkRecord
  /** Rank after time filtering, with zero being the best match. */
  denseRank: number
}

export async function semanticSearch(
  deps: SemanticSearchDeps,
  params: SemanticSearchParams
): Promise<SemanticSearchHit[]> {
  const { embedder, store } = deps
  const { query, dbPathHash, modelId, dim, finalTopK = 5, timeRangeMs } = params

  if (!query.trim()) return []

  // Enlarge the ANN pool when filtering by time so narrow ranges still have enough candidates.
  const poolFactor = timeRangeMs ? TIME_FILTER_POOL_MULTIPLIER : 1
  const denseTopN = Math.max((params.denseTopN ?? 40) * poolFactor, 40)

  const queryVector = await embedder.embedQuery(query)
  const dense = store.queryDense({ dbPathHash, modelId, dim, embedding: queryVector, k: denseTopN })

  const results: SemanticSearchHit[] = []
  for (const hit of dense) {
    if (!overlapsTimeRangeMs(hit.record, timeRangeMs)) continue
    results.push({
      chunkId: hit.chunkId,
      score: 1 / (1 + Math.max(0, hit.distance)),
      record: hit.record,
      denseRank: results.length,
    })
    if (results.length >= finalTopK) break
  }

  return results
}
