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
 * - embedding 是瓶颈；每 chunk 前检查停止信号，暂停/取消可快速响应。
 *
 * 依赖全部注入，便于单测（fake source/embedder + 真实内存级 SQLite store）。
 */

import type { EmbeddingProvider } from '../embedding/types'
import { chunkMessages, type ChunkMessageInput, type ChunkSource } from '../chunker'
import { CHUNKER_VERSION, STRATEGY_ID, composeChunkId, type ChunkerConfig } from '../chunker-config'
import type { EmbeddingIndexStore } from '../store'
import type { SemanticIndexStateStore } from '../session-state-store'
import type { ChunkRecord } from '../types'

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

export async function runWarmup(options: WarmupRunnerOptions): Promise<WarmupResult> {
  const { dbPathHash, modelId, embedder, store, stateStore, source, config, checkStop } = options

  let chunksWritten = 0
  try {
    const messages = source.readAllMessages()
    const total = source.countMessages()
    stateStore.updateProgress(dbPathHash, { indexStatus: 'running', totalMessages: total, error: null })

    // 消息 id -> 流位置，用于进度计数（消息按 ts 排序，id 未必单调）
    const streamIndexById = new Map<number, number>()
    messages.forEach((m, i) => streamIndexById.set(m.id, i))

    const resumeMessageId = stateStore.getState(dbPathHash)?.lastIndexedMessageId ?? null
    const resumeIndex = resumeMessageId !== null ? (streamIndexById.get(resumeMessageId) ?? -1) : -1

    const { chunks, chunkerConfigHash } = chunkMessages({ messages, source: source.getSource(), config })

    // 续跑时统计已写入 chunk 数，保证 chunkCount 连续
    let storedChunkCount = stateStore.getState(dbPathHash)?.chunkCount ?? 0
    if (resumeIndex < 0) storedChunkCount = 0

    for (const chunk of chunks) {
      const chunkEndIndex = streamIndexById.get(chunk.endMessageId) ?? -1
      if (chunkEndIndex <= resumeIndex) continue

      const stop = checkStop?.()
      if (stop) {
        stateStore.setIndexStatus(dbPathHash, stop === 'paused' ? 'paused' : 'cancelled')
        return { status: stop, chunksWritten }
      }

      const [vector] = await embedder.embedDocuments([chunk.embeddingInput])
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
        indexedAt: Date.now(),
        status: 'indexed',
      }
      store.insertChunk(record, vector)
      chunksWritten++
      storedChunkCount++

      stateStore.updateProgress(dbPathHash, {
        indexStatus: 'running',
        indexedMessages: chunkEndIndex + 1,
        lastIndexedMessageId: chunk.endMessageId,
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
