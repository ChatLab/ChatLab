/**
 * Session index management — Electron worker wrappers.
 * Pure SQL logic lives in @openchatlab/core; this module handles
 * DB connection lifecycle (open / close / cache invalidation).
 */

import {
  DEFAULT_SESSION_GAP_THRESHOLD,
  hasSessionIndex as coreHasSessionIndex,
  getSessionIndexStats as coreGetSessionIndexStats,
  getChatSessionList as coreGetChatSessionList,
  getSessionsByTimeRange as coreGetSessionsByTimeRange,
  getRecentChatSessions as coreGetRecentChatSessions,
  getSegmentSummary as coreGetChatSessionSummary,
  saveSegmentSummary as coreSaveChatSessionSummary,
  updateSessionGapThreshold as coreUpdateSessionGapThreshold,
  clearSessionIndex as coreClearSessionIndex,
  generateSessionIndex as coreGenerateSessionIndex,
  generateIncrementalSessionIndex as coreGenerateIncrementalSessionIndex,
  getSegmentSummaries as coreGetSessionSummaries,
} from '@openchatlab/core'
import type { ChatSessionItem, SessionIndexStats, SegmentSummaryData } from '@openchatlab/core'
import { openWritableDatabase, openReadonlyDatabase, closeDatabase } from './core'
import { wrapAsDatabaseAdapter } from '../../core'

// Re-export types so existing Electron imports keep working
export type { ChatSessionItem, SessionIndexStats }

function withReadonlyAdapter<T>(
  sessionId: string,
  fn: (adapter: import('@openchatlab/core').DatabaseAdapter) => T,
  fallback: T
): T {
  const db = openReadonlyDatabase(sessionId)
  if (!db) return fallback
  try {
    return fn(wrapAsDatabaseAdapter(db))
  } finally {
    db.close()
  }
}

function withWritableAdapter<T>(sessionId: string, fn: (adapter: import('@openchatlab/core').DatabaseAdapter) => T): T {
  closeDatabase(sessionId)
  const db = openWritableDatabase(sessionId)
  if (!db) throw new Error(`Cannot open writable database: ${sessionId}`)
  try {
    return fn(wrapAsDatabaseAdapter(db))
  } finally {
    db.close()
  }
}

export function generateSessions(
  sessionId: string,
  gapThreshold: number = DEFAULT_SESSION_GAP_THRESHOLD,
  onProgress?: (current: number, total: number) => void
): number {
  return withWritableAdapter(sessionId, (adapter) => coreGenerateSessionIndex(adapter, gapThreshold, onProgress))
}

export function generateIncrementalSessions(
  sessionId: string,
  gapThreshold: number = DEFAULT_SESSION_GAP_THRESHOLD
): number {
  return withWritableAdapter(sessionId, (adapter) => coreGenerateIncrementalSessionIndex(adapter, gapThreshold))
}

export function clearSessions(sessionId: string): void {
  withWritableAdapter(sessionId, (adapter) => coreClearSessionIndex(adapter))
}

export function hasSessionIndex(sessionId: string): boolean {
  return withReadonlyAdapter(sessionId, (adapter) => coreHasSessionIndex(adapter), false)
}

export function getSessionStats(sessionId: string): SessionIndexStats {
  return withReadonlyAdapter(sessionId, (adapter) => coreGetSessionIndexStats(adapter), {
    sessionCount: 0,
    hasIndex: false,
    gapThreshold: DEFAULT_SESSION_GAP_THRESHOLD,
  })
}

export interface SessionIndexStatusItem {
  sessionId: string
  hasIndex: boolean
  sessionCount: number
}

export function getAllIndexStats(sessionIds: string[]): SessionIndexStatusItem[] {
  return sessionIds.map((sessionId) => {
    const stats = getSessionStats(sessionId)
    return { sessionId, hasIndex: stats.hasIndex, sessionCount: stats.sessionCount }
  })
}

export function updateSessionGapThreshold(sessionId: string, gapThreshold: number | null): void {
  withWritableAdapter(sessionId, (adapter) => coreUpdateSessionGapThreshold(adapter, gapThreshold))
}

export function getSessions(sessionId: string): ChatSessionItem[] {
  return withReadonlyAdapter(sessionId, (adapter) => coreGetChatSessionList(adapter), [])
}

export function getSessionsByTimeRange(sessionId: string, startTs: number, endTs: number): ChatSessionItem[] {
  return withReadonlyAdapter(sessionId, (adapter) => coreGetSessionsByTimeRange(adapter, startTs, endTs), [])
}

export function getRecentChatSessions(sessionId: string, limit: number): ChatSessionItem[] {
  return withReadonlyAdapter(sessionId, (adapter) => coreGetRecentChatSessions(adapter, limit), [])
}

export function getSegmentSummariesInWorker(
  sessionId: string,
  options?: { limit?: number; timeFilter?: { startTs: number; endTs: number } }
): SegmentSummaryData[] {
  return withReadonlyAdapter(sessionId, (adapter) => coreGetSessionSummaries(adapter, options), [])
}

export function saveSessionSummary(sessionId: string, segmentId: number, summary: string): void {
  withWritableAdapter(sessionId, (adapter) => coreSaveChatSessionSummary(adapter, segmentId, summary))
}

export function getSessionSummary(sessionId: string, segmentId: number): string | null {
  return withReadonlyAdapter(sessionId, (adapter) => coreGetChatSessionSummary(adapter, segmentId), null)
}
