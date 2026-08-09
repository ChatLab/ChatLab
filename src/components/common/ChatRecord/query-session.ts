import type { ChatRecordQuery } from './types'

export function resolveChatRecordSessionId(query: ChatRecordQuery, fallbackSessionId?: string | null): string | null {
  return query.sessionId?.trim() || fallbackSessionId || null
}

export function preserveChatRecordSessionId(
  nextQuery: ChatRecordQuery,
  currentQuery: ChatRecordQuery
): ChatRecordQuery {
  const sessionId = currentQuery.sessionId?.trim()
  return sessionId ? { ...nextQuery, sessionId } : nextQuery
}

/**
 * Scope a query to the explicit chat session so page changes cannot reuse stale data.
 */
export function scopeChatRecordQueryToSession(query: ChatRecordQuery, sessionId: string): ChatRecordQuery {
  return { ...query, sessionId }
}
