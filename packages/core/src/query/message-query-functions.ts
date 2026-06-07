/**
 * Shared async message query functions.
 *
 * Platform-agnostic query logic that both Electron (Worker) and CLI Web (pluginQuery)
 * consume via their respective AsyncSqlExecutor implementations.
 *
 * SQL templates, row mapping, and condition builders come from ./message-sql.ts.
 * FTS/tokenisation search remains platform-specific — only LIKE-based search is shared here.
 */

import type { TimeFilter } from '@openchatlab/shared-types'
import type { AsyncSqlExecutor } from './executor'
import {
  FULL_MSG_SELECT,
  FULL_MSG_FROM,
  MSG_COUNT_FROM,
  mapMessageRow,
  buildMsgConditions,
  type FullMessageRow,
  type MappedMessage,
} from './message-sql'

// ==================== Result types ====================

export interface AsyncPaginatedMessages {
  messages: MappedMessage[]
  hasMore: boolean
}

export interface AsyncMessagesWithTotal {
  messages: MappedMessage[]
  total: number
}

export interface AsyncConversationData {
  messages: MappedMessage[]
  total: number
  member1Name: string
  member2Name: string
}

// ==================== Internal helpers ====================

function filterConditions(
  filter?: TimeFilter,
  senderId?: number,
  keywords?: string[]
): { clause: string; params: unknown[] } {
  return buildMsgConditions({
    startTs: filter?.startTs,
    endTs: filter?.endTs,
    senderId,
    memberId: filter?.memberId,
    keywords,
  })
}

// ==================== Query functions ====================

/**
 * Fetch N messages before a given id (infinite scroll upward).
 * Results are returned in ascending order (oldest → newest).
 */
export async function fetchMessagesBefore(
  executor: AsyncSqlExecutor,
  beforeId: number,
  limit: number = 50,
  filter?: TimeFilter,
  senderId?: number,
  keywords?: string[]
): Promise<AsyncPaginatedMessages> {
  const { clause, params } = filterConditions(filter, senderId, keywords)
  const sql = `${FULL_MSG_SELECT} WHERE msg.id < ? ${clause} ORDER BY msg.id DESC LIMIT ?`
  const rows = await executor.all<FullMessageRow>(sql, [beforeId, ...params, limit + 1])
  const hasMore = rows.length > limit
  const sliced = hasMore ? rows.slice(0, limit) : rows
  return { messages: sliced.map(mapMessageRow).reverse(), hasMore }
}

/**
 * Fetch N messages after a given id (infinite scroll downward).
 * Results are returned in ascending order.
 */
export async function fetchMessagesAfter(
  executor: AsyncSqlExecutor,
  afterId: number,
  limit: number = 50,
  filter?: TimeFilter,
  senderId?: number,
  keywords?: string[]
): Promise<AsyncPaginatedMessages> {
  const { clause, params } = filterConditions(filter, senderId, keywords)
  const sql = `${FULL_MSG_SELECT} WHERE msg.id > ? ${clause} ORDER BY msg.id ASC LIMIT ?`
  const rows = await executor.all<FullMessageRow>(sql, [afterId, ...params, limit + 1])
  const hasMore = rows.length > limit
  const sliced = hasMore ? rows.slice(0, limit) : rows
  return { messages: sliced.map(mapMessageRow), hasMore }
}

/**
 * LIKE-based keyword search with count + pagination.
 * FTS search is NOT included here — platforms should handle FTS themselves
 * and fall back to this function when FTS is unavailable.
 */
/**
 * FTS5-based message search. The matchQuery must be pre-tokenized for the platform's FTS tokenizer.
 */
export async function searchMessagesWithFtsAsync(
  executor: AsyncSqlExecutor,
  matchQuery: string,
  filter?: TimeFilter,
  limit: number = 20,
  offset: number = 0,
  senderId?: number
): Promise<AsyncMessagesWithTotal> {
  const { clause, params } = filterConditions(filter, senderId)

  const countSql = `SELECT COUNT(*) as total ${MSG_COUNT_FROM} WHERE msg.id IN (SELECT rowid FROM message_fts WHERE content MATCH ?) ${clause}`
  const countRow = await executor.get<{ total: number }>(countSql, [matchQuery, ...params])
  const total = countRow?.total ?? 0

  const sql = `${FULL_MSG_SELECT} WHERE msg.id IN (SELECT rowid FROM message_fts WHERE content MATCH ?) ${clause} ORDER BY msg.ts DESC LIMIT ? OFFSET ?`
  const rows = await executor.all<FullMessageRow>(sql, [matchQuery, ...params, limit, offset])
  return { messages: rows.map(mapMessageRow), total }
}

export async function searchMessagesLikeAsync(
  executor: AsyncSqlExecutor,
  keywords: string[],
  filter?: TimeFilter,
  limit: number = 20,
  offset: number = 0,
  senderId?: number
): Promise<AsyncMessagesWithTotal> {
  const { clause, params } = filterConditions(filter, senderId, keywords)

  const countSql = `SELECT COUNT(*) as total ${MSG_COUNT_FROM} WHERE 1=1 ${clause}`
  const countRow = await executor.get<{ total: number }>(countSql, params)
  const total = countRow?.total ?? 0

  const sql = `${FULL_MSG_SELECT} WHERE 1=1 ${clause} ORDER BY msg.ts DESC LIMIT ? OFFSET ?`
  const rows = await executor.all<FullMessageRow>(sql, [...params, limit, offset])
  return { messages: rows.map(mapMessageRow), total }
}

/**
 * Get surrounding context messages for given message IDs.
 * Uses simple id-based ordering (not session-aware).
 */
export async function fetchMessageContext(
  executor: AsyncSqlExecutor,
  messageIds: number | number[],
  contextSize: number = 20
): Promise<MappedMessage[]> {
  const ids = Array.isArray(messageIds) ? messageIds : [messageIds]
  if (ids.length === 0) return []

  const allIds = new Set<number>()

  for (const id of ids) {
    allIds.add(id)
    if (contextSize > 0) {
      const before = await executor.all<{ id: number }>(
        'SELECT id FROM message WHERE id < ? ORDER BY id DESC LIMIT ?',
        [id, contextSize]
      )
      before.forEach((r) => allIds.add(r.id))

      const after = await executor.all<{ id: number }>('SELECT id FROM message WHERE id > ? ORDER BY id ASC LIMIT ?', [
        id,
        contextSize,
      ])
      after.forEach((r) => allIds.add(r.id))
    }
  }

  const idList = Array.from(allIds).sort((a, b) => a - b)
  if (idList.length === 0) return []

  const placeholders = idList.map(() => '?').join(', ')
  const sql = `${FULL_MSG_SELECT} WHERE msg.id IN (${placeholders}) ORDER BY msg.id ASC`
  const rows = await executor.all<FullMessageRow>(sql, idList)
  return rows.map(mapMessageRow)
}

/**
 * Get context messages around search results.
 * Session-aware when message_context table is available, falls back to id-based.
 */
export async function fetchSearchMessageContext(
  executor: AsyncSqlExecutor,
  messageIds: number[],
  contextBefore: number = 2,
  contextAfter: number = 2
): Promise<MappedMessage[]> {
  if (messageIds.length === 0) return []

  const contextIds = new Set<number>()

  const sessionCheck = await executor.get<Record<string, unknown>>(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='message_context'",
    []
  )
  let hasSessionData = false
  if (sessionCheck) {
    const dataCheck = await executor.get<Record<string, unknown>>('SELECT 1 FROM message_context LIMIT 1', [])
    hasSessionData = dataCheck !== undefined
  }

  for (const messageId of messageIds) {
    contextIds.add(messageId)

    if (hasSessionData) {
      const sessionRow = await executor.get<{ segment_id: number }>(
        'SELECT segment_id FROM message_context WHERE message_id = ?',
        [messageId]
      )

      if (sessionRow) {
        if (contextBefore > 0) {
          const rows = await executor.all<{ id: number }>(
            `SELECT mc.message_id as id FROM message_context mc
             WHERE mc.segment_id = ? AND mc.message_id < ?
             ORDER BY mc.message_id DESC LIMIT ?`,
            [sessionRow.segment_id, messageId, contextBefore]
          )
          rows.forEach((r) => contextIds.add(r.id))
        }
        if (contextAfter > 0) {
          const rows = await executor.all<{ id: number }>(
            `SELECT mc.message_id as id FROM message_context mc
             WHERE mc.segment_id = ? AND mc.message_id > ?
             ORDER BY mc.message_id ASC LIMIT ?`,
            [sessionRow.segment_id, messageId, contextAfter]
          )
          rows.forEach((r) => contextIds.add(r.id))
        }
        continue
      }
    }

    if (contextBefore > 0) {
      const rows = await executor.all<{ id: number }>('SELECT id FROM message WHERE id < ? ORDER BY id DESC LIMIT ?', [
        messageId,
        contextBefore,
      ])
      rows.forEach((r) => contextIds.add(r.id))
    }
    if (contextAfter > 0) {
      const rows = await executor.all<{ id: number }>('SELECT id FROM message WHERE id > ? ORDER BY id ASC LIMIT ?', [
        messageId,
        contextAfter,
      ])
      rows.forEach((r) => contextIds.add(r.id))
    }
  }

  const idList = Array.from(contextIds).sort((a, b) => a - b)
  if (idList.length === 0) return []

  const placeholders = idList.map(() => '?').join(', ')
  const sql = `${FULL_MSG_SELECT} WHERE msg.id IN (${placeholders}) ORDER BY msg.ts ASC, msg.id ASC`
  const rows = await executor.all<FullMessageRow>(sql, idList)
  return rows.map(mapMessageRow)
}

/**
 * Get all recent messages (message viewer — includes all message types).
 * Results are returned in ascending order (oldest → newest).
 */
export async function fetchAllRecentMessages(
  executor: AsyncSqlExecutor,
  filter?: TimeFilter,
  limit: number = 100
): Promise<AsyncMessagesWithTotal> {
  const { clause, params } = filterConditions(filter)

  const countSql = `SELECT COUNT(*) as total ${MSG_COUNT_FROM} WHERE 1=1 ${clause}`
  const countRow = await executor.get<{ total: number }>(countSql, params)
  const total = countRow?.total ?? 0

  const sql = `${FULL_MSG_SELECT} WHERE 1=1 ${clause} ORDER BY msg.ts DESC LIMIT ?`
  const rows = await executor.all<FullMessageRow>(sql, [...params, limit])
  return { messages: rows.map(mapMessageRow).reverse(), total }
}

/**
 * Get recent text-only messages (AI Agent use — excludes system messages and non-text).
 * Results are returned in ascending order (oldest → newest).
 */
export async function fetchRecentTextMessages(
  executor: AsyncSqlExecutor,
  filter?: TimeFilter,
  limit: number = 100
): Promise<AsyncMessagesWithTotal> {
  const { clause, params } = buildMsgConditions({
    startTs: filter?.startTs,
    endTs: filter?.endTs,
    memberId: filter?.memberId,
    systemFilter: true,
    textOnlyFilter: true,
  })

  const countSql = `SELECT COUNT(*) as total ${MSG_COUNT_FROM} WHERE 1=1 ${clause}`
  const countRow = await executor.get<{ total: number }>(countSql, params)
  const total = countRow?.total ?? 0

  const sql = `${FULL_MSG_SELECT} WHERE 1=1 ${clause} ORDER BY msg.ts DESC LIMIT ?`
  const rows = await executor.all<FullMessageRow>(sql, [...params, limit])
  return { messages: rows.map(mapMessageRow).reverse(), total }
}

/**
 * Get conversation messages between two members.
 */
export async function fetchConversationBetween(
  executor: AsyncSqlExecutor,
  memberId1: number,
  memberId2: number,
  filter?: TimeFilter,
  limit: number = 100
): Promise<AsyncConversationData> {
  const member1 = await executor.get<{ name: string }>(
    'SELECT COALESCE(group_nickname, account_name, platform_id) as name FROM member WHERE id = ?',
    [memberId1]
  )
  const member2 = await executor.get<{ name: string }>(
    'SELECT COALESCE(group_nickname, account_name, platform_id) as name FROM member WHERE id = ?',
    [memberId2]
  )

  if (!member1 || !member2) {
    return { messages: [], total: 0, member1Name: '', member2Name: '' }
  }

  const { clause, params } = buildMsgConditions({
    startTs: filter?.startTs,
    endTs: filter?.endTs,
    memberId: filter?.memberId,
  })

  const countSql = `
    SELECT COUNT(*) as total ${FULL_MSG_FROM}
    WHERE msg.sender_id IN (?, ?)
    ${clause}
    AND msg.content IS NOT NULL AND msg.content != ''
  `
  const countRow = await executor.get<{ total: number }>(countSql, [memberId1, memberId2, ...params])
  const total = countRow?.total ?? 0

  const sql = `
    ${FULL_MSG_SELECT}
    WHERE msg.sender_id IN (?, ?)
    ${clause}
    AND msg.content IS NOT NULL AND msg.content != ''
    ORDER BY msg.ts DESC
    LIMIT ?
  `
  const rows = await executor.all<FullMessageRow>(sql, [memberId1, memberId2, ...params, limit])

  return {
    messages: rows.map(mapMessageRow).reverse(),
    total,
    member1Name: member1.name,
    member2Name: member2.name,
  }
}
