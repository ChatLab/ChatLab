/**
 * SessionIndexAdapter — 会话索引领域适配器接口
 *
 * 负责会话切分索引的生成、查询、摘要等操作。
 * 统一通过 FetchSessionIndexAdapter 消费共享 HTTP 路由。
 */

export interface SessionStats {
  sessionCount: number
  hasIndex: boolean
  gapThreshold: number
}

export interface ChatSessionItem {
  id: number
  startTs: number
  endTs: number
  messageCount: number
  firstMessageId: number
  summary?: string | null
}

export interface SummaryResult {
  success: boolean
  summary?: string
  error?: string
}

export interface BatchSummaryResult {
  success: number
  failed: number
  skipped: number
}

export interface CanGenerateInfo {
  canGenerate: boolean
  reason?: string
}

export interface SessionIndexStatusItem {
  sessionId: string
  hasIndex: boolean
  sessionCount: number
}

export interface SessionIndexAdapter {
  generate(sessionId: string, gapThreshold?: number): Promise<number>
  generateIncremental(sessionId: string, gapThreshold?: number): Promise<number>
  hasIndex(sessionId: string): Promise<boolean>
  getStats(sessionId: string): Promise<SessionStats>
  getAllIndexStats(): Promise<SessionIndexStatusItem[]>
  clear(sessionId: string): Promise<boolean>
  updateGapThreshold(sessionId: string, gapThreshold: number | null): Promise<boolean>
  getSessions(sessionId: string): Promise<ChatSessionItem[]>
  getByTimeRange(sessionId: string, startTs: number, endTs: number): Promise<ChatSessionItem[]>
  getRecent(sessionId: string, limit: number): Promise<ChatSessionItem[]>

  generateSummary(
    dbSessionId: string,
    segmentId: number,
    locale?: string,
    forceRegenerate?: boolean,
    strategy?: 'brief' | 'standard'
  ): Promise<SummaryResult>

  generateSummaries(dbSessionId: string, segmentIds: number[], locale?: string): Promise<BatchSummaryResult>

  checkCanGenerateSummary(dbSessionId: string, segmentIds: number[]): Promise<Record<number, CanGenerateInfo>>
}
