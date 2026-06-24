import type { SemanticIndexConfig, SemanticIndexConfigInput } from './config'
import type {
  SemanticIndexSessionStatus,
  SemanticSearchResult,
  SemanticSearchToolOptions,
  SemanticSearchToolResult,
} from './service'

export type MaybePromise<T> = T | Promise<T>

/**
 * 语义索引运行时的公共能力面。
 *
 * 真实 SemanticIndexService 和 worker client 都实现这组方法；调用方必须 await 返回值，
 * 这样本进程实现和跨 worker RPC 可以共用同一套 HTTP/Agent 入口。
 */
export interface SemanticIndexRuntime {
  getConfig(): MaybePromise<SemanticIndexConfig>
  setConfig(config: SemanticIndexConfigInput, options?: { apiKey?: string }): MaybePromise<SemanticIndexConfig>
  getModelStatus(): MaybePromise<'idle' | 'downloading' | 'ready' | 'error'>
  isConfigured(): MaybePromise<boolean>
  hasApiKey(): MaybePromise<boolean>

  enable(sessionId: string): MaybePromise<void>
  disable(sessionId: string): MaybePromise<void>
  build(sessionId: string): MaybePromise<void>
  pause(sessionId: string): MaybePromise<void>
  cancel(sessionId: string): MaybePromise<void>
  rebuild(sessionId: string): MaybePromise<void>
  buildAllPending(): MaybePromise<void>

  listEnabledStatuses(): MaybePromise<SemanticIndexSessionStatus[]>
  status(sessionId: string): MaybePromise<SemanticIndexSessionStatus | null>
  statusForSessions(sessionIds: string[]): MaybePromise<SemanticIndexSessionStatus[]>

  canSearch(sessionId: string): MaybePromise<boolean>
  search(
    sessionId: string,
    query: string,
    options?: { finalTopK?: number; timeRangeMs?: { startTs?: number; endTs?: number } }
  ): Promise<SemanticSearchResult>
  searchForTool(
    sessionId: string,
    query: string,
    options?: SemanticSearchToolOptions
  ): Promise<SemanticSearchToolResult>

  cleanupUnused(): MaybePromise<{ cleaned: number }>
  recover(): MaybePromise<void>
  close(): MaybePromise<void>
}
