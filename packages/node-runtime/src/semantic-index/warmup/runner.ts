/**
 * 单对话 warmup runner
 *
 * 职责（chunking-decision-final.md 第 9/15 节）：读取对话消息流 -> 全量 chunk ->
 * 逐 chunk embedding 并增量写入向量库 -> 实时更新业务状态。支持暂停、取消、失败处理
 * 和断点续跑，部分完成即可被检索。
 *
 * 设计要点：
 * - chunk 是纯函数且廉价，每次运行对全量消息重新 chunk（保证 parent 边界稳定）。
 * - 通过业务状态的 lastIndexedMessageId 游标跳过已写入 chunk，实现断点续跑。
 * - 每写入一个 chunk 即更新游标，保证崩溃后续跑不重复写入（chunk_id UNIQUE）。
 * - embedding 是瓶颈；每 chunk 前检查暂停/取消，embedding 返回后再次检查取消，
 *   避免在清理已取消索引后写入刚完成的向量。
 *
 * 依赖全部注入，便于单测（fake source/embedder + 真实内存级 SQLite store）。
 */

import type { EmbeddingProvider } from '../embedding/types'
import { chunkMessages, type ChunkMessageInput, type ChunkSource } from '../chunker'
import { CHUNKER_VERSION, STRATEGY_ID, composeChunkId, type ChunkerConfig } from '../chunker-config'
import type { EmbeddingIndexStore } from '../store'
import type { SemanticIndexStateStore } from '../session-state-store'
import type { ChunkInsert, ChunkRecord } from '../types'

/** 对话消息来源（warmup 输入抽象，真实实现读取聊天库） */
export interface SemanticMessageSource {
  getSource(): ChunkSource
  countMessages(): number
  /** 按 ts, id 升序返回全部消息 */
  readAllMessages(): ChunkMessageInput[]
}

/** 停止信号：返回 null 继续，'paused' 暂停（可续跑），'cancelled' 取消 */
export type StopSignal = () => null | 'paused' | 'cancelled'

export interface WarmupRunnerOptions {
  dbPathHash: string
  modelId: string
  embedder: EmbeddingProvider
  store: EmbeddingIndexStore
  stateStore: SemanticIndexStateStore
  source: SemanticMessageSource
  config?: ChunkerConfig
  checkStop?: StopSignal
}

export type WarmupStatus = 'completed' | 'paused' | 'cancelled' | 'failed'

export interface WarmupResult {
  status: WarmupStatus
  chunksWritten: number
  error?: string
}

function resolveDocumentBatchSize(embedder: EmbeddingProvider): number {
  const size = embedder.documentBatchSize
  return Number.isFinite(size) && size && size > 0 ? Math.floor(size) : 1
}

export async function runWarmup(options: WarmupRunnerOptions): Promise<WarmupResult> {
  const { dbPathHash, modelId, embedder, store, stateStore, source, config, checkStop } = options

  let chunksWritten = 0
  try {
    const messages = source.readAllMessages()
    const total = source.countMessages()
    const savedState = stateStore.getState(dbPathHash)
    stateStore.updateProgress(dbPathHash, { indexStatus: 'running', totalMessages: total, error: null })

    // 消息 id -> 流位置，用于进度计数（消息按 ts 排序，id 未必单调）
    const streamIndexById = new Map<number, number>()
    messages.forEach((m, i) => streamIndexById.set(m.id, i))

    const resumeMessageId = savedState?.lastIndexedMessageId ?? null
    const rawResumeIndex = resumeMessageId !== null ? (streamIndexById.get(resumeMessageId) ?? -1) : -1

    // Detect non-append-only additions: if the cursor's new stream position doesn't match the
    // saved indexed count, older messages were backfilled before the cursor. Clear vectors and
    // re-index from scratch to avoid silently missing the backfilled messages.
    const isNonAppendOnly = rawResumeIndex >= 0 && rawResumeIndex + 1 !== (savedState?.indexedMessages ?? 0)
    if (isNonAppendOnly) {
      store.deleteByDbPathHash(dbPathHash)
    }
    const { chunks, chunkerConfigHash } = chunkMessages({ messages, source: source.getSource(), config })

    const chunkRanges = chunks.map((chunk) => ({
      chunk,
      startIndex: streamIndexById.get(chunk.startMessageId) ?? -1,
      endIndex: streamIndexById.get(chunk.endMessageId) ?? -1,
    }))

    let resumeIndex = isNonAppendOnly ? -1 : rawResumeIndex
    const hasAppendedMessages = !isNonAppendOnly && rawResumeIndex >= 0 && total > (savedState?.totalMessages ?? 0)
    if (hasAppendedMessages) {
      const cursorRange =
        chunkRanges.find((range) => range.startIndex <= rawResumeIndex && rawResumeIndex <= range.endIndex) ??
        chunkRanges.filter((range) => range.endIndex <= rawResumeIndex).sort((a, b) => b.endIndex - a.endIndex)[0]

      if (cursorRange) {
        const parentRanges = chunkRanges.filter((range) => range.chunk.parentId === cursorRange.chunk.parentId)
        const rewindIndex = Math.min(...parentRanges.map((range) => range.startIndex).filter((index) => index >= 0))
        const rewindMessage = messages[rewindIndex]
        if (rewindMessage) {
          store.deleteByModelFromPosition({
            dbPathHash,
            modelId,
            startTs: rewindMessage.ts,
            startMessageId: rewindMessage.id,
          })
          resumeIndex = rewindIndex - 1
        }
      }
    }

    // 续跑时统计已写入 chunk 数，保证 chunkCount 连续
    let storedChunkCount = store.countChunks(dbPathHash, modelId)
    if (resumeIndex < 0) storedChunkCount = 0

    const pendingRanges = chunkRanges.filter(({ endIndex }) => endIndex > resumeIndex)
    const batchSize = resolveDocumentBatchSize(embedder)
    for (let i = 0; i < pendingRanges.length; i += batchSize) {
      const batchRanges = pendingRanges.slice(i, i + batchSize)

      const stop = checkStop?.()
      if (stop) {
        stateStore.setIndexStatus(dbPathHash, stop === 'paused' ? 'paused' : 'cancelled')
        return { status: stop, chunksWritten }
      }

      const vectors = await embedder.embedDocuments(batchRanges.map(({ chunk }) => chunk.embeddingInput))
      if (vectors.length !== batchRanges.length) {
        throw new Error(`embedding provider returned ${vectors.length} vectors for ${batchRanges.length} inputs`)
      }
      const stopAfterEmbedding = checkStop?.()
      if (stopAfterEmbedding === 'cancelled') {
        stateStore.setIndexStatus(dbPathHash, 'cancelled')
        return { status: 'cancelled', chunksWritten }
      }

      // API provider 支持一次提交多个文本；本地 Qwen3 仍声明 batch=1，避免 last_token 污染。
      const indexedAt = Date.now()
      const inserts: ChunkInsert[] = batchRanges.map(({ chunk }, index) => {
        const vector = vectors[index]
        const record: ChunkRecord = {
          chunkId: composeChunkId(dbPathHash, modelId, chunk.localChunkId),
          dbPathHash,
          strategyId: STRATEGY_ID,
          modelId,
          dim: vector.length,
          parentId: chunk.parentId,
          startMessageId: chunk.startMessageId,
          endMessageId: chunk.endMessageId,
          startTs: chunk.startTs,
          endTs: chunk.endTs,
          messageCount: chunk.messageCount,
          rawContentHash: chunk.rawContentHash,
          embeddingInputHash: chunk.embeddingInputHash,
          chunkerVersion: CHUNKER_VERSION,
          chunkerConfigHash,
          indexedAt,
          status: 'indexed',
        }
        return { record, embedding: vector }
      })
      store.insertChunks(inserts)
      chunksWritten += inserts.length
      storedChunkCount += inserts.length

      const lastRange = batchRanges[batchRanges.length - 1]
      stateStore.updateProgress(dbPathHash, {
        indexStatus: 'running',
        indexedMessages: lastRange.endIndex + 1,
        lastIndexedMessageId: lastRange.chunk.endMessageId,
        chunkCount: storedChunkCount,
      })
    }

    stateStore.updateProgress(dbPathHash, { indexedMessages: total, chunkCount: storedChunkCount })
    stateStore.setIndexStatus(dbPathHash, 'completed', null)
    return { status: 'completed', chunksWritten }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    stateStore.setIndexStatus(dbPathHash, 'failed', message)
    return { status: 'failed', chunksWritten, error: message }
  }
}
