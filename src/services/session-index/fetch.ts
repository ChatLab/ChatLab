/**
 * FetchSessionIndexAdapter — Web (CLI serve) 模式的会话索引实现
 *
 * 部分操作通过 HTTP 端点实现，部分通过 pluginQuery SQL 查询。
 * 摘要生成在 Web 模式下不可用。
 */

import type {
  SessionIndexAdapter,
  SessionStats,
  ChatSessionItem,
  SummaryResult,
  BatchSummaryResult,
  CanGenerateInfo,
} from './types'

import { getRegisteredAdapter } from '../registry'
import type { DataAdapter } from '../data/types'

function getDataAdapter(): DataAdapter {
  return getRegisteredAdapter<DataAdapter>('data')
}

export class FetchSessionIndexAdapter implements SessionIndexAdapter {
  async generate(sessionId: string, gapThreshold: number = 1800): Promise<number> {
    const resp = await fetch(`/_web/sessions/${sessionId}/generate-index`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gapThreshold }),
    })
    if (!resp.ok) throw new Error(`Failed to generate session index: ${resp.status}`)
    const result = (await resp.json()) as { sessionCount: number }
    return result.sessionCount
  }

  async generateIncremental(sessionId: string, gapThreshold: number = 1800): Promise<number> {
    const resp = await fetch(`/_web/sessions/${sessionId}/generate-incremental-index`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gapThreshold }),
    })
    if (!resp.ok) throw new Error(`Failed to generate incremental session index: ${resp.status}`)
    const result = (await resp.json()) as { sessionCount: number }
    return result.sessionCount
  }

  async hasIndex(sessionId: string): Promise<boolean> {
    const stats = await this.getStats(sessionId)
    return stats.hasIndex
  }

  async getStats(sessionId: string): Promise<SessionStats> {
    try {
      const rows = await getDataAdapter().pluginQuery<{ cnt: number }>(
        sessionId,
        'SELECT COUNT(*) as cnt FROM chat_session',
        []
      )
      const count = rows[0]?.cnt ?? 0
      return { hasIndex: count > 0, sessionCount: count, gapThreshold: 1800 }
    } catch {
      return { hasIndex: false, sessionCount: 0, gapThreshold: 1800 }
    }
  }

  async clear(sessionId: string): Promise<boolean> {
    await fetch(`/_web/sessions/${sessionId}/clear-index`, { method: 'POST' })
    return true
  }

  async updateGapThreshold(_sessionId: string, _gapThreshold: number | null): Promise<boolean> {
    return true
  }

  async getSessions(sessionId: string): Promise<ChatSessionItem[]> {
    return getDataAdapter().pluginQuery<ChatSessionItem>(
      sessionId,
      'SELECT id, start_ts as startTs, end_ts as endTs, message_count as messageCount, summary FROM chat_session ORDER BY start_ts ASC',
      []
    )
  }

  async getByTimeRange(sessionId: string, startTs: number, endTs: number): Promise<ChatSessionItem[]> {
    return getDataAdapter().pluginQuery<ChatSessionItem>(
      sessionId,
      'SELECT id, start_ts as startTs, end_ts as endTs, message_count as messageCount, summary FROM chat_session WHERE start_ts >= ? AND end_ts <= ? ORDER BY start_ts ASC',
      [startTs, endTs]
    )
  }

  async getRecent(sessionId: string, limit: number): Promise<ChatSessionItem[]> {
    return getDataAdapter().pluginQuery<ChatSessionItem>(
      sessionId,
      'SELECT id, start_ts as startTs, end_ts as endTs, message_count as messageCount, summary FROM chat_session ORDER BY start_ts DESC LIMIT ?',
      [limit]
    )
  }

  async generateSummary(): Promise<SummaryResult> {
    return { success: false, error: 'Not available in web mode' }
  }

  async generateSummaries(): Promise<BatchSummaryResult> {
    return { success: 0, failed: 0, skipped: 0 }
  }

  async checkCanGenerateSummary(
    _dbSessionId: string,
    _chatSessionIds: number[]
  ): Promise<Record<number, CanGenerateInfo>> {
    return {}
  }
}
