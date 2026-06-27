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
