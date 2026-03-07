/**
 * Session index API client — replaces window.sessionApi
 *
 * Maps preload IPC calls to HTTP endpoints under /api/sessions/:id/session-index.
 */

import { get, post, put, del } from './client'

// ─────────────────────────── types ───────────────────────────

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

// ─────────────────────────── sessionApi ───────────────────────────

export const sessionApi = {
  generate: (sessionId: string, gapThreshold?: number) =>
    post<{ success: boolean; sessionCount: number }>(`/sessions/${sessionId}/session-index/generate`, {
      ...(gapThreshold !== undefined ? { gapThreshold } : {}),
    }).then((r) => r.sessionCount),

  hasIndex: (sessionId: string) =>
    get<{ hasIndex: boolean }>(`/sessions/${sessionId}/session-index/has-index`).then((r) => r.hasIndex),

  getStats: (sessionId: string) =>
    get<SessionStats>(`/sessions/${sessionId}/session-index/stats`),

  clear: (sessionId: string) =>
    del<{ success: boolean }>(`/sessions/${sessionId}/session-index/clear`).then((r) => r.success ?? true),

  updateGapThreshold: (sessionId: string, gapThreshold: number | null) =>
    put<{ success: boolean }>(`/sessions/${sessionId}/session-index/gap-threshold`, { gapThreshold }).then((r) => r.success ?? true),

  getSessions: (sessionId: string) =>
    get<ChatSessionItem[]>(`/sessions/${sessionId}/session-index/sessions`),

  generateSummary: (
    dbSessionId: string,
    chatSessionId: number,
    locale?: string,
    forceRegenerate?: boolean,
  ) =>
    post<{ success: boolean; summary?: string; error?: string }>(
      `/sessions/${dbSessionId}/session-index/summary`,
      { chatSessionId, locale, forceRegenerate },
    ),

  generateSummaries: (dbSessionId: string, chatSessionIds: number[], locale?: string) =>
    post<{ success: number; failed: number; skipped: number }>(
      `/sessions/${dbSessionId}/session-index/summaries`,
      { chatSessionIds, locale },
    ),

  checkCanGenerateSummary: (dbSessionId: string, chatSessionIds: number[]) =>
    post<Record<number, { canGenerate: boolean; reason?: string }>>(
      `/sessions/${dbSessionId}/session-index/check-can-summarize`,
      { chatSessionIds },
    ),

  getByTimeRange: (
    dbSessionId: string,
    startTs: number,
    endTs: number,
  ) =>
    get<Array<{
      id: number
      startTs: number
      endTs: number
      messageCount: number
      summary: string | null
    }>>(`/sessions/${dbSessionId}/session-index/by-time-range`, { startTs, endTs }),

  getRecent: (dbSessionId: string, limit: number) =>
    get<Array<{
      id: number
      startTs: number
      endTs: number
      messageCount: number
      summary: string | null
    }>>(`/sessions/${dbSessionId}/session-index/recent`, { limit }),
}
