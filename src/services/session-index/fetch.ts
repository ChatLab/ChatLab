/**
 * FetchSessionIndexAdapter — Web (CLI serve) 模式的会话索引实现
 *
 * 部分操作通过 HTTP 端点实现，部分通过 pluginQuery SQL 查询。
 * 摘要生成在 Web 模式下不可用。
 */

import type {
  SessionIndexAdapter,
  SessionStats,
  SessionIndexStatusItem,
  ChatSessionItem,
  SummaryResult,
  BatchSummaryResult,
  CanGenerateInfo,
} from './types'

import { getRegisteredAdapter } from '../registry'
import type { DataAdapter } from '../data/types'
import { fetchWithAuth } from '../utils/http'

function getDataAdapter(): DataAdapter {
  return getRegisteredAdapter<DataAdapter>('data')
}

export class FetchSessionIndexAdapter implements SessionIndexAdapter {
  async generate(sessionId: string, gapThreshold: number = 1800): Promise<number> {
    const resp = await fetchWithAuth(`/_web/sessions/${sessionId}/generate-index`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gapThreshold }),
    })
    if (!resp.ok) throw new Error(`Failed to generate session index: ${resp.status}`)
    const result = (await resp.json()) as { sessionCount: number }
    return result.sessionCount
  }

  async generateIncremental(sessionId: string, gapThreshold: number = 1800): Promise<number> {
    const resp = await fetchWithAuth(`/_web/sessions/${sessionId}/generate-incremental-index`, {
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
        'SELECT COUNT(*) as cnt FROM segment',
        []
      )
      const count = rows[0]?.cnt ?? 0
      return { hasIndex: count > 0, sessionCount: count, gapThreshold: 1800 }
    } catch {
      return { hasIndex: false, sessionCount: 0, gapThreshold: 1800 }
    }
  }

  async getAllIndexStats(): Promise<SessionIndexStatusItem[]> {
    const resp = await fetchWithAuth('/_web/sessions/index-stats')
    if (!resp.ok) return []
    return (await resp.json()) as SessionIndexStatusItem[]
  }

  async clear(sessionId: string): Promise<boolean> {
    await fetchWithAuth(`/_web/sessions/${sessionId}/clear-index`, { method: 'POST' })
    return true
  }

  async updateGapThreshold(_sessionId: string, _gapThreshold: number | null): Promise<boolean> {
    return true
  }

  async getSessions(sessionId: string): Promise<ChatSessionItem[]> {
    return getDataAdapter().pluginQuery<ChatSessionItem>(
      sessionId,
      'SELECT id, start_ts as startTs, end_ts as endTs, message_count as messageCount, summary FROM segment ORDER BY start_ts ASC',
      []
    )
  }

  async getByTimeRange(sessionId: string, startTs: number, endTs: number): Promise<ChatSessionItem[]> {
    return getDataAdapter().pluginQuery<ChatSessionItem>(
      sessionId,
      'SELECT id, start_ts as startTs, end_ts as endTs, message_count as messageCount, summary FROM segment WHERE start_ts >= ? AND end_ts <= ? ORDER BY start_ts ASC',
      [startTs, endTs]
    )
  }

  async getRecent(sessionId: string, limit: number): Promise<ChatSessionItem[]> {
    return getDataAdapter().pluginQuery<ChatSessionItem>(
      sessionId,
      'SELECT id, start_ts as startTs, end_ts as endTs, message_count as messageCount, summary FROM segment ORDER BY start_ts DESC LIMIT ?',
      [limit]
    )
  }

  async generateSummary(
    dbSessionId: string,
    segmentId: number,
    locale?: string,
    forceRegenerate?: boolean,
    strategy?: 'brief' | 'standard'
  ): Promise<SummaryResult> {
    try {
      const resp = await fetchWithAuth(`/_web/sessions/${dbSessionId}/summaries/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segmentId, locale, forceRegenerate, strategy }),
      })
      const result = await resp.json()
      if (!resp.ok) {
        return { success: false, error: result.error || `HTTP ${resp.status}` }
      }
      return result
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async generateSummaries(dbSessionId: string, segmentIds: number[], locale?: string): Promise<BatchSummaryResult> {
    // Call generateSummary individually for each selected session so that only
    // the requested IDs are processed, matching the Electron adapter's behaviour.
    // Previously this called /generate-all and ignored segmentIds entirely,
    // which caused every session in the database to be regenerated.
    let success = 0
    let failed = 0
    const skipped = 0

    for (const segmentId of segmentIds) {
      try {
        const result = await this.generateSummary(dbSessionId, segmentId, locale)
        if (result.success) {
          success++
        } else {
          failed++
        }
      } catch {
        failed++
      }
    }

    return { success, failed, skipped }
  }

  async checkCanGenerateSummary(dbSessionId: string, segmentIds: number[]): Promise<Record<number, CanGenerateInfo>> {
    try {
      const resp = await fetchWithAuth(`/_web/sessions/${dbSessionId}/summaries/check-can-generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segmentIds }),
      })
      if (!resp.ok) return {}
      return await resp.json()
    } catch {
      return {}
    }
  }
}
