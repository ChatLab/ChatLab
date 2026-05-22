/**
 * ElectronSessionIndexAdapter — wrap window.sessionApi IPC
 */

import type {
  SessionIndexAdapter,
  SessionStats,
  ChatSessionItem,
  SummaryResult,
  BatchSummaryResult,
  CanGenerateInfo,
} from './types'

export class ElectronSessionIndexAdapter implements SessionIndexAdapter {
  generate(sessionId: string, gapThreshold?: number): Promise<number> {
    return window.sessionApi.generate(sessionId, gapThreshold)
  }

  generateIncremental(sessionId: string, gapThreshold?: number): Promise<number> {
    return window.sessionApi.generateIncremental(sessionId, gapThreshold)
  }

  hasIndex(sessionId: string): Promise<boolean> {
    return window.sessionApi.hasIndex(sessionId)
  }

  getStats(sessionId: string): Promise<SessionStats> {
    return window.sessionApi.getStats(sessionId)
  }

  clear(sessionId: string): Promise<boolean> {
    return window.sessionApi.clear(sessionId)
  }

  updateGapThreshold(sessionId: string, gapThreshold: number | null): Promise<boolean> {
    return window.sessionApi.updateGapThreshold(sessionId, gapThreshold)
  }

  getSessions(sessionId: string): Promise<ChatSessionItem[]> {
    return window.sessionApi.getSessions(sessionId)
  }

  getByTimeRange(sessionId: string, startTs: number, endTs: number): Promise<ChatSessionItem[]> {
    return window.sessionApi.getByTimeRange(sessionId, startTs, endTs) as Promise<ChatSessionItem[]>
  }

  getRecent(sessionId: string, limit: number): Promise<ChatSessionItem[]> {
    return window.sessionApi.getRecent(sessionId, limit) as Promise<ChatSessionItem[]>
  }

  generateSummary(
    dbSessionId: string,
    chatSessionId: number,
    locale?: string,
    forceRegenerate?: boolean
  ): Promise<SummaryResult> {
    return window.sessionApi.generateSummary(dbSessionId, chatSessionId, locale, forceRegenerate)
  }

  generateSummaries(dbSessionId: string, chatSessionIds: number[], locale?: string): Promise<BatchSummaryResult> {
    return window.sessionApi.generateSummaries(dbSessionId, chatSessionIds, locale)
  }

  checkCanGenerateSummary(dbSessionId: string, chatSessionIds: number[]): Promise<Record<number, CanGenerateInfo>> {
    return window.sessionApi.checkCanGenerateSummary(dbSessionId, chatSessionIds)
  }
}
