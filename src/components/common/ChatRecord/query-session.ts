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
 * 将查询固定到明确的聊天会话，避免页面切换后继续读取上一会话的数据。
 */
export function scopeChatRecordQueryToSession(query: ChatRecordQuery, sessionId: string): ChatRecordQuery {
  return { ...query, sessionId }
}
