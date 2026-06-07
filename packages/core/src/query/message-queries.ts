/**
 * 消息查询模块（平台无关）
 *
 * 提供消息搜索、分页等基础查询能力。
 * 复杂的 FTS 搜索留在 Electron/Server 层处理（依赖分词器）。
 */

import type { TimeFilter } from '@openchatlab/shared-types'
import type { DatabaseAdapter } from '../interfaces'
import { buildTimeFilter, hasTable, hasColumn } from './filters'
import { FULL_MSG_SELECT, mapMessageRow, type FullMessageRow, type MappedMessage } from './message-sql'

export interface MessageResult {
  id: number
  senderId: number
  senderName: string
  senderPlatformId: string
  content: string
  timestamp: number
  type: number
}

export interface PaginatedMessages {
  messages: MessageResult[]
  hasMore: boolean
  total?: number
}

export interface QueryMessagesOptions {
  keyword?: string
  startTs?: number
  endTs?: number
  senderId?: number
  limit?: number
  offset?: number
}

export interface QueryMessagesResult {
  messages: MessageResult[]
  total: number
  page: number
  limit: number
  totalPages: number
}

/**
 * 通用分页消息查询
 * 支持关键词、时间范围、发送者过滤
 */
export function queryMessages(db: DatabaseAdapter, options?: QueryMessagesOptions): QueryMessagesResult {
  const limit = Math.min(1000, Math.max(1, options?.limit ?? 100))
  const offset = options?.offset ?? 0
  const page = Math.floor(offset / limit) + 1

  const conditions: string[] = ["COALESCE(m.account_name, '') != '系统消息'"]
  const params: unknown[] = []

  if (options?.keyword) {
    conditions.push('msg.content LIKE ?')
    params.push(`%${options.keyword}%`)
  }
  if (options?.startTs !== undefined) {
    conditions.push('msg.ts >= ?')
    params.push(options.startTs)
  }
  if (options?.endTs !== undefined) {
    conditions.push('msg.ts <= ?')
    params.push(options.endTs)
  }
  if (options?.senderId !== undefined) {
    conditions.push('msg.sender_id = ?')
    params.push(options.senderId)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const countRow = db
    .prepare(
      `SELECT COUNT(*) as total
       FROM message msg
       JOIN member m ON msg.sender_id = m.id
       ${where}`
    )
    .get(...params) as { total: number }

  const rows = db
    .prepare(
      `SELECT
        msg.id as id,
        m.id as senderId,
        COALESCE(m.group_nickname, m.account_name, m.platform_id) as senderName,
        m.platform_id as senderPlatformId,
        msg.content as content,
        msg.ts as timestamp,
        msg.type as type
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${where}
      ORDER BY msg.ts DESC
      LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as Array<{
    id: number
    senderId: number
    senderName: string
    senderPlatformId: string
    content: string
    timestamp: number
    type: number
  }>

  const messages = rows.map((row) => ({
    id: Number(row.id),
    senderId: Number(row.senderId),
    senderName: String(row.senderName || ''),
    senderPlatformId: String(row.senderPlatformId || ''),
    content: row.content != null ? String(row.content) : '',
    timestamp: Number(row.timestamp),
    type: Number(row.type),
  }))

  const total = countRow.total
  return {
    messages,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  }
}

/**
 * 基于 LIKE 的简单关键词搜索
 * 不依赖 FTS 索引，适用于 CLI/MCP 场景
 */
export function searchMessagesLike(
  db: DatabaseAdapter,
  keyword: string,
  options?: { limit?: number; offset?: number }
): PaginatedMessages {
  const limit = options?.limit ?? 50
  const offset = options?.offset ?? 0

  const countRow = db
    .prepare(
      `SELECT COUNT(*) as total
       FROM message msg
       JOIN member m ON msg.sender_id = m.id
       WHERE msg.content LIKE ? AND COALESCE(m.account_name, '') != '系统消息'`
    )
    .get(`%${keyword}%`) as { total: number }

  const rows = db
    .prepare(
      `SELECT
        msg.id as id,
        m.id as senderId,
        COALESCE(m.group_nickname, m.account_name, m.platform_id) as senderName,
        m.platform_id as senderPlatformId,
        msg.content as content,
        msg.ts as timestamp,
        msg.type as type
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      WHERE msg.content LIKE ? AND COALESCE(m.account_name, '') != '系统消息'
      ORDER BY msg.ts DESC
      LIMIT ? OFFSET ?`
    )
    .all(`%${keyword}%`, limit + 1, offset) as Array<{
    id: number
    senderId: number
    senderName: string
    senderPlatformId: string
    content: string
    timestamp: number
    type: number
  }>

  const hasMore = rows.length > limit
  const messages = rows.slice(0, limit).map((row) => ({
    id: Number(row.id),
    senderId: Number(row.senderId),
    senderName: String(row.senderName || ''),
    senderPlatformId: String(row.senderPlatformId || ''),
    content: row.content != null ? String(row.content) : '',
    timestamp: Number(row.timestamp),
    type: Number(row.type),
  }))

  return { messages, hasMore, total: countRow.total }
}

/**
 * 获取最近 N 条消息
 */
export function getRecentMessages(db: DatabaseAdapter, options?: { limit?: number }): MessageResult[] {
  const limit = options?.limit ?? 50

  const rows = db
    .prepare(
      `SELECT
        msg.id as id,
        m.id as senderId,
        COALESCE(m.group_nickname, m.account_name, m.platform_id) as senderName,
        m.platform_id as senderPlatformId,
        msg.content as content,
        msg.ts as timestamp,
        msg.type as type
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      WHERE COALESCE(m.account_name, '') != '系统消息'
      ORDER BY msg.ts DESC
      LIMIT ?`
    )
    .all(limit) as Array<{
    id: number
    senderId: number
    senderName: string
    senderPlatformId: string
    content: string
    timestamp: number
    type: number
  }>

  return rows.map((row) => ({
    id: Number(row.id),
    senderId: Number(row.senderId),
    senderName: String(row.senderName || ''),
    senderPlatformId: String(row.senderPlatformId || ''),
    content: row.content != null ? String(row.content) : '',
    timestamp: Number(row.timestamp),
    type: Number(row.type),
  }))
}

/**
 * 获取成员列表
 */
export function getMembers(
  db: DatabaseAdapter
): Array<{ id: number; platformId: string; name: string; messageCount: number }> {
  return db
    .prepare(
      `SELECT
        m.id as id,
        m.platform_id as platformId,
        COALESCE(m.group_nickname, m.account_name, m.platform_id) as name,
        (SELECT COUNT(*) FROM message WHERE sender_id = m.id) as messageCount
      FROM member m
      WHERE COALESCE(m.account_name, '') != '系统消息'
      ORDER BY messageCount DESC`
    )
    .all() as Array<{ id: number; platformId: string; name: string; messageCount: number }>
}

export interface MemberDetailed {
  id: number
  platformId: string
  accountName: string
  groupNickname: string | null
  messageCount: number
}

/**
 * 获取完整字段的成员列表（含 accountName、groupNickname）
 */
export function getMembersDetailed(db: DatabaseAdapter): MemberDetailed[] {
  const rows = db
    .prepare(
      `SELECT
        m.id as id,
        m.platform_id as platformId,
        COALESCE(m.account_name, m.platform_id) as accountName,
        m.group_nickname as groupNickname,
        (SELECT COUNT(*) FROM message WHERE sender_id = m.id) as messageCount
      FROM member m
      WHERE COALESCE(m.account_name, '') != '系统消息'
      ORDER BY messageCount DESC`
    )
    .all() as Array<{
    id: number
    platformId: string
    accountName: string
    groupNickname: string | null
    messageCount: number
  }>

  return rows.map((row) => ({
    id: Number(row.id),
    platformId: String(row.platformId),
    accountName: String(row.accountName || row.platformId),
    groupNickname: row.groupNickname ? String(row.groupNickname) : null,
    messageCount: Number(row.messageCount),
  }))
}

/**
 * 执行只读 SQL 查询（SQL Lab）— 保留向后兼容签名
 */
export function executeReadonlySql(
  db: DatabaseAdapter,
  sql: string,
  maxRows: number = 1000
): { columns: string[]; rows: Record<string, unknown>[]; rowCount: number; truncated: boolean } {
  const result = executeSql(db, sql, { maxRows })
  return {
    columns: result.columns,
    rows: result.rows as Record<string, unknown>[],
    rowCount: result.rowCount,
    truncated: result.truncated,
  }
}

// ==================== Unified SQL Execution ====================

export interface SqlExecutionOptions {
  /** Maximum rows to return. 0 = no limit. Default: 1000. */
  maxRows?: number
  /** Return rows as 2D arrays instead of objects. Default: false. */
  columnar?: boolean
  /** Include execution duration in result. Default: false. */
  timing?: boolean
}

export interface SqlExecutionResult {
  columns: string[]
  rows: Record<string, unknown>[] | unknown[][]
  rowCount: number
  truncated: boolean
  duration?: number
}

/**
 * Unified readonly SQL execution.
 *
 * Safety: uses stmt.readonly when available (better-sqlite3 native check),
 * falls back to keyword denylist for adapters that don't expose it.
 */
export function executeSql(db: DatabaseAdapter, sql: string, options?: SqlExecutionOptions): SqlExecutionResult {
  const maxRows = options?.maxRows ?? 1000
  const columnar = options?.columnar ?? false
  const timing = options?.timing ?? false

  const trimmed = sql.trim()

  const startTime = timing ? Date.now() : 0

  const stmt = db.prepare(trimmed)

  if (stmt.readonly === false) {
    throw new Error('Only read-only statements are allowed (SELECT / WITH)')
  }

  if (stmt.readonly === undefined) {
    const forbidden = /^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|REINDEX|VACUUM|PRAGMA)/i
    if (forbidden.test(trimmed)) {
      throw new Error('Only SELECT queries are allowed')
    }
  }

  const needsLimit = maxRows > 0 && !/\bLIMIT\b/i.test(trimmed)
  let allRows: Record<string, unknown>[]

  if (needsLimit) {
    const safeSql = `${trimmed} LIMIT ${maxRows + 1}`
    allRows = db.prepare(safeSql).all() as Record<string, unknown>[]
  } else {
    allRows = stmt.all() as Record<string, unknown>[]
  }

  const truncated = maxRows > 0 && allRows.length > maxRows
  const resultRows = truncated ? allRows.slice(0, maxRows) : allRows
  const columns = resultRows.length > 0 ? Object.keys(resultRows[0]) : []

  const duration = timing ? Date.now() - startTime : undefined

  if (columnar) {
    const rows2d = resultRows.map((row) => columns.map((col) => row[col]))
    return { columns, rows: rows2d, rowCount: rows2d.length, truncated, duration }
  }

  return { columns, rows: resultRows, rowCount: resultRows.length, truncated, duration }
}

/** Table schema with column details */
export interface TableSchema {
  name: string
  columns: Array<{
    name: string
    type: string
    notnull: boolean
    pk: boolean
  }>
}

/**
 * Get database schema with column-level details.
 * Returns table names + full column info via PRAGMA table_info.
 */
export function getSchemaDetailed(db: DatabaseAdapter): TableSchema[] {
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type='table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`
    )
    .all() as Array<{ name: string }>

  return tables.map((table) => {
    const columns = db.prepare(`PRAGMA table_info('${table.name}')`).all() as Array<{
      cid: number
      name: string
      type: string
      notnull: number
      dflt_value: unknown
      pk: number
    }>

    return {
      name: table.name,
      columns: columns.map((col) => ({
        name: col.name,
        type: col.type,
        notnull: col.notnull === 1,
        pk: col.pk === 1,
      })),
    }
  })
}

// ==================== Context & Conversation Queries ====================

export interface ContextMessage {
  id: number
  senderId: number
  senderName: string
  senderPlatformId: string
  content: string | null
  timestamp: number
}

export interface ConversationData {
  messages: ContextMessage[]
  total: number
  member1Name: string
  member2Name: string
}

export interface MemberNameHistoryEntry {
  nameType: string
  name: string
  startTs: number
  endTs: number | null
}

function getMemberNameHistoryFromMessages(db: DatabaseAdapter, memberId: number): MemberNameHistoryEntry[] {
  const rows = db
    .prepare(
      `SELECT
        sender_account_name as accountName,
        sender_group_nickname as groupNickname,
        MIN(ts) as startTs,
        MAX(ts) as endTs
      FROM message
      WHERE sender_id = ?
      GROUP BY sender_account_name, sender_group_nickname
      ORDER BY startTs`
    )
    .all(memberId) as unknown as Array<{
    accountName: string | null
    groupNickname: string | null
    startTs: number
    endTs: number | null
  }>

  const history: MemberNameHistoryEntry[] = []
  for (const row of rows) {
    if (row.accountName) {
      history.push({ nameType: 'account_name', name: row.accountName, startTs: row.startTs, endTs: row.endTs })
    }
    if (row.groupNickname) {
      history.push({ nameType: 'group_nickname', name: row.groupNickname, startTs: row.startTs, endTs: row.endTs })
    }
  }
  return history
}

export interface MemberWithAliases {
  id: number
  platformId: string
  accountName: string | null
  groupNickname: string | null
  aliases: string[]
  avatar: string | null
  messageCount: number
}

export interface MembersPaginationParams {
  page?: number
  pageSize?: number
  search?: string
  sortOrder?: 'asc' | 'desc'
}

export interface MembersPaginatedResult {
  members: MemberWithAliases[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

/**
 * Batch-load messages by IDs with full sender info (avatar, aliases, reply, etc.)
 */
function hydrateMessagesByIds(db: DatabaseAdapter, ids: number[]): MappedMessage[] {
  if (ids.length === 0) return []
  const placeholders = ids.map(() => '?').join(', ')
  const rows = db
    .prepare(`${FULL_MSG_SELECT} WHERE msg.id IN (${placeholders}) ORDER BY msg.id ASC`)
    .all(...ids) as unknown as FullMessageRow[]
  return rows.map(mapMessageRow)
}

/**
 * Get surrounding context messages for given message IDs.
 * Uses simple id-based ordering (not session-aware).
 */
export function getMessageContext(
  db: DatabaseAdapter,
  messageIds: number[],
  contextSize: number = 20
): MappedMessage[] {
  if (messageIds.length === 0) return []

  const contextIds = new Set<number>()

  for (const messageId of messageIds) {
    contextIds.add(messageId)

    const beforeRows = db
      .prepare('SELECT id FROM message WHERE id < ? ORDER BY id DESC LIMIT ?')
      .all(messageId, contextSize) as { id: number }[]
    beforeRows.forEach((r) => contextIds.add(r.id))

    const afterRows = db
      .prepare('SELECT id FROM message WHERE id > ? ORDER BY id ASC LIMIT ?')
      .all(messageId, contextSize) as { id: number }[]
    afterRows.forEach((r) => contextIds.add(r.id))
  }

  return hydrateMessagesByIds(db, Array.from(contextIds))
}

/**
 * Get context messages around search results.
 * Session-aware when message_context table is available, falls back to id-based ordering.
 */
export function getSearchMessageContext(
  db: DatabaseAdapter,
  messageIds: number[],
  contextBefore: number = 2,
  contextAfter: number = 2
): MappedMessage[] {
  if (messageIds.length === 0) return []

  const contextIds = new Set<number>()

  const hasSessionData =
    hasTable(db, 'message_context') &&
    (db.prepare('SELECT 1 FROM message_context LIMIT 1').get() as Record<string, unknown> | undefined) !== undefined

  for (const messageId of messageIds) {
    contextIds.add(messageId)

    if (hasSessionData) {
      const sessionRow = db.prepare('SELECT segment_id FROM message_context WHERE message_id = ?').get(messageId) as
        | { segment_id: number }
        | undefined

      if (sessionRow) {
        if (contextBefore > 0) {
          const rows = db
            .prepare(
              `SELECT mc.message_id as id FROM message_context mc
               WHERE mc.segment_id = ? AND mc.message_id < ?
               ORDER BY mc.message_id DESC LIMIT ?`
            )
            .all(sessionRow.segment_id, messageId, contextBefore) as { id: number }[]
          rows.forEach((r) => contextIds.add(r.id))
        }
        if (contextAfter > 0) {
          const rows = db
            .prepare(
              `SELECT mc.message_id as id FROM message_context mc
               WHERE mc.segment_id = ? AND mc.message_id > ?
               ORDER BY mc.message_id ASC LIMIT ?`
            )
            .all(sessionRow.segment_id, messageId, contextAfter) as { id: number }[]
          rows.forEach((r) => contextIds.add(r.id))
        }
        continue
      }
    }

    if (contextBefore > 0) {
      const rows = db
        .prepare('SELECT id FROM message WHERE id < ? ORDER BY id DESC LIMIT ?')
        .all(messageId, contextBefore) as { id: number }[]
      rows.forEach((r) => contextIds.add(r.id))
    }
    if (contextAfter > 0) {
      const rows = db
        .prepare('SELECT id FROM message WHERE id > ? ORDER BY id ASC LIMIT ?')
        .all(messageId, contextAfter) as { id: number }[]
      rows.forEach((r) => contextIds.add(r.id))
    }
  }

  return hydrateMessagesByIds(db, Array.from(contextIds))
}

/**
 * Get conversation messages between two members
 */
export function getConversationBetween(
  db: DatabaseAdapter,
  memberId1: number,
  memberId2: number,
  filter?: TimeFilter,
  limit: number = 100
): ConversationData {
  const member1 = db
    .prepare('SELECT COALESCE(group_nickname, account_name, platform_id) as name FROM member WHERE id = ?')
    .get(memberId1) as { name: string } | undefined

  const member2 = db
    .prepare('SELECT COALESCE(group_nickname, account_name, platform_id) as name FROM member WHERE id = ?')
    .get(memberId2) as { name: string } | undefined

  if (!member1 || !member2) {
    return { messages: [], total: 0, member1Name: '', member2Name: '' }
  }

  const { clause: timeClause, params: timeParams } = buildTimeFilter(filter, 'msg')
  const timeCondition = timeClause ? timeClause.replace('WHERE', 'AND') : ''

  const countSql = `
    SELECT COUNT(*) as total FROM message msg
    WHERE msg.sender_id IN (?, ?) ${timeCondition}
    AND msg.content IS NOT NULL AND msg.content != ''
  `
  const totalRow = db.prepare(countSql).get(memberId1, memberId2, ...timeParams) as { total: number }

  const sql = `
    SELECT
      msg.id as id, m.id as senderId,
      COALESCE(m.group_nickname, m.account_name, m.platform_id) as senderName,
      m.platform_id as senderPlatformId,
      msg.content as content, msg.ts as timestamp
    FROM message msg
    JOIN member m ON msg.sender_id = m.id
    WHERE msg.sender_id IN (?, ?) ${timeCondition}
    AND msg.content IS NOT NULL AND msg.content != ''
    ORDER BY msg.ts DESC LIMIT ?
  `
  const rows = db.prepare(sql).all(memberId1, memberId2, ...timeParams, limit) as unknown as ContextMessage[]

  return {
    messages: rows.reverse(),
    total: totalRow?.total || 0,
    member1Name: member1.name,
    member2Name: member2.name,
  }
}

/**
 * Get name change history for a member
 */
export function getMemberNameHistory(db: DatabaseAdapter, memberId: number): MemberNameHistoryEntry[] {
  if (!hasTable(db, 'member_name_history')) return getMemberNameHistoryFromMessages(db, memberId)

  const history = db
    .prepare(
      `SELECT name_type as nameType, name, start_ts as startTs, end_ts as endTs
       FROM member_name_history WHERE member_id = ? ORDER BY start_ts DESC`
    )
    .all(memberId) as unknown as MemberNameHistoryEntry[]

  return history.length > 0 ? history : getMemberNameHistoryFromMessages(db, memberId)
}

/**
 * Get member list with aliases, avatar and detailed info
 */
export function getMembersWithAliases(db: DatabaseAdapter): MemberWithAliases[] {
  const aliasesAvailable = hasColumn(db, 'member', 'aliases')
  const avatarAvailable = hasColumn(db, 'member', 'avatar')

  const aliasesSelect = aliasesAvailable ? 'm.aliases' : 'NULL as aliases'
  const avatarSelect = avatarAvailable ? 'm.avatar' : 'NULL as avatar'
  const rows = db
    .prepare(
      `SELECT
        m.id, m.platform_id as platformId,
        m.account_name as accountName, m.group_nickname as groupNickname,
        ${aliasesSelect}, ${avatarSelect},
        COUNT(msg.id) as messageCount
      FROM member m
      LEFT JOIN message msg ON m.id = msg.sender_id
      WHERE COALESCE(m.group_nickname, m.account_name, m.platform_id) != '系统消息'
      GROUP BY m.id ORDER BY messageCount DESC`
    )
    .all() as Array<{
    id: number
    platformId: string
    accountName: string | null
    groupNickname: string | null
    aliases: string | null
    avatar: string | null
    messageCount: number
  }>

  return rows.map(mapMemberRow)
}

/**
 * Paginated member list with search and sort.
 */
export function getMembersPaginated(db: DatabaseAdapter, params: MembersPaginationParams): MembersPaginatedResult {
  const page = Math.max(1, params.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20))
  const search = params.search?.trim() || ''
  const sortDirection = params.sortOrder === 'asc' ? 'ASC' : 'DESC'

  const aliasesAvailable = hasColumn(db, 'member', 'aliases')
  const avatarAvailable = hasColumn(db, 'member', 'avatar')
  const aliasesSelect = aliasesAvailable ? 'm.aliases' : 'NULL as aliases'
  const avatarSelect = avatarAvailable ? 'm.avatar' : 'NULL as avatar'

  let searchClause = ''
  const searchParams: unknown[] = []
  if (search) {
    const clauses = ['m.account_name LIKE ?', 'm.group_nickname LIKE ?', 'm.platform_id LIKE ?']
    const like = `%${search}%`
    searchParams.push(like, like, like)
    if (aliasesAvailable) {
      clauses.push('m.aliases LIKE ?')
      searchParams.push(like)
    }
    searchClause = `AND (${clauses.join(' OR ')})`
  }

  const systemFilter = "COALESCE(m.group_nickname, m.account_name, m.platform_id) != '系统消息'"

  const countRow = db
    .prepare(
      `SELECT COUNT(*) as total FROM (
        SELECT m.id FROM member m
        LEFT JOIN message msg ON m.id = msg.sender_id
        WHERE ${systemFilter} ${searchClause}
        GROUP BY m.id
      )`
    )
    .get(...searchParams) as { total: number } | undefined

  const total = countRow?.total ?? 0
  const totalPages = Math.ceil(total / pageSize)
  const offset = (page - 1) * pageSize

  const rows = db
    .prepare(
      `SELECT
        m.id, m.platform_id as platformId,
        m.account_name as accountName, m.group_nickname as groupNickname,
        ${aliasesSelect}, ${avatarSelect},
        COUNT(msg.id) as messageCount
      FROM member m
      LEFT JOIN message msg ON m.id = msg.sender_id
      WHERE ${systemFilter} ${searchClause}
      GROUP BY m.id
      ORDER BY messageCount ${sortDirection}
      LIMIT ? OFFSET ?`
    )
    .all(...searchParams, pageSize, offset) as Array<{
    id: number
    platformId: string
    accountName: string | null
    groupNickname: string | null
    aliases: string | null
    avatar: string | null
    messageCount: number
  }>

  return { members: rows.map(mapMemberRow), total, page, pageSize, totalPages }
}

function mapMemberRow(row: {
  id: number
  platformId: string
  accountName: string | null
  groupNickname: string | null
  aliases: string | null
  avatar: string | null
  messageCount: number
}): MemberWithAliases {
  return {
    id: row.id,
    platformId: row.platformId,
    accountName: row.accountName,
    groupNickname: row.groupNickname,
    aliases: row.aliases ? JSON.parse(row.aliases) : [],
    avatar: row.avatar ?? null,
    messageCount: row.messageCount,
  }
}

/**
 * Execute a parameterized read-only SQL query with named bindings.
 * Used by SQL analysis tools to run predefined queries with user-supplied parameters.
 */
export function executeParameterizedSql<T = Record<string, unknown>>(
  db: DatabaseAdapter,
  query: string,
  params: Record<string, unknown> = {}
): T[] {
  const trimmed = query.trim()

  const forbidden = /^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|REINDEX|VACUUM|PRAGMA)/i
  if (forbidden.test(trimmed)) {
    throw new Error('Only SELECT queries are allowed')
  }

  const stmt = db.prepare(trimmed)

  if (stmt.readonly === false) {
    throw new Error('Only READ-ONLY statements are allowed')
  }

  return stmt.all(params) as T[]
}
