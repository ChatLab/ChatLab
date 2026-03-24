/**
 * Core SQL query functions for MCP Server
 * Extracted from electron/main/worker/query/ modules
 *
 * All functions receive a Database instance directly (no session management).
 */

import type Database from 'better-sqlite3'

// ==================== Types ====================

export interface TimeFilter {
  startTs?: number
  endTs?: number
  memberId?: number | null
}

export interface MessageResult {
  id: number
  senderId: number
  senderName: string
  senderPlatformId: string
  content: string
  timestamp: number
  type: number
}

export interface MessagesWithTotal {
  messages: MessageResult[]
  total: number
}

export interface MemberInfo {
  id: number
  platformId: string
  accountName: string | null
  groupNickname: string | null
  aliases: string[]
  messageCount: number
}

export interface MemberActivity {
  memberId: number
  platformId: string
  name: string
  messageCount: number
  percentage: number
}

export interface HourlyActivity {
  hour: number
  messageCount: number
}

export interface DailyActivity {
  date: string
  messageCount: number
}

export interface WeekdayActivity {
  weekday: number
  messageCount: number
}

export interface MonthlyActivity {
  month: number
  messageCount: number
}

export interface NameHistoryEntry {
  nameType: string
  name: string
  startTs: number
  endTs: number | null
}

export interface SQLResult {
  columns: string[]
  rows: unknown[][]
  rowCount: number
  duration: number
}

export interface TableSchema {
  name: string
  columns: {
    name: string
    type: string
    notnull: boolean
    pk: boolean
  }[]
}

// ==================== Time Filter Utilities ====================

function buildTimeFilter(
  filter?: TimeFilter,
  tableAlias?: string
): { clause: string; params: (number | string)[] } {
  const conditions: string[] = []
  const params: (number | string)[] = []

  const tsColumn = tableAlias ? `${tableAlias}.ts` : 'ts'
  const senderIdColumn = tableAlias ? `${tableAlias}.sender_id` : 'sender_id'

  if (filter?.startTs !== undefined) {
    conditions.push(`${tsColumn} >= ?`)
    params.push(filter.startTs)
  }
  if (filter?.endTs !== undefined) {
    conditions.push(`${tsColumn} <= ?`)
    params.push(filter.endTs)
  }
  if (filter?.memberId !== undefined && filter?.memberId !== null) {
    conditions.push(`${senderIdColumn} = ?`)
    params.push(filter.memberId)
  }

  return {
    clause: conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '',
    params,
  }
}

function buildSystemMessageFilter(existingClause: string): string {
  const systemFilter = "COALESCE(m.account_name, '') != '系统消息'"
  if (existingClause.includes('WHERE')) {
    return existingClause + ' AND ' + systemFilter
  } else {
    return ' WHERE ' + systemFilter
  }
}

// ==================== Message Row Processing ====================

interface DbMessageRow {
  id: number
  senderId: number
  senderName: string
  senderPlatformId: string
  content: string
  timestamp: number
  type: number
}

function sanitizeMessageRow(row: DbMessageRow): MessageResult {
  return {
    id: Number(row.id),
    senderId: Number(row.senderId),
    senderName: String(row.senderName || ''),
    senderPlatformId: String(row.senderPlatformId || ''),
    content: row.content != null ? String(row.content) : '',
    timestamp: Number(row.timestamp),
    type: Number(row.type),
  }
}

// Exclude system messages
const SYSTEM_FILTER = "AND COALESCE(m.account_name, '') != '系统消息'"

// Text-only filter
const TEXT_ONLY_FILTER = "AND msg.type = 0 AND msg.content IS NOT NULL AND msg.content != ''"

// ==================== Query Functions ====================

/**
 * Search messages by keywords
 */
export function searchMessages(
  db: Database.Database,
  keywords: string[],
  options?: {
    senderId?: number
    limit?: number
    offset?: number
    timeFilter?: TimeFilter
  }
): MessagesWithTotal {
  const limit = options?.limit ?? 50
  const offset = options?.offset ?? 0

  // Build keyword condition
  let keywordCondition = '1=1'
  const keywordParams: string[] = []
  if (keywords.length > 0) {
    keywordCondition = `(${keywords.map(() => `msg.content LIKE ?`).join(' OR ')})`
    keywordParams.push(...keywords.map((k) => `%${k}%`))
  }

  // Build time filter
  const { clause: timeClause, params: timeParams } = buildTimeFilter(options?.timeFilter, 'msg')
  const timeCondition = timeClause ? timeClause.replace('WHERE', 'AND') : ''

  // Build sender filter
  const senderCondition = options?.senderId !== undefined ? 'AND msg.sender_id = ?' : ''
  const senderParams: number[] = options?.senderId !== undefined ? [options.senderId] : []

  // Count total
  const countSql = `
    SELECT COUNT(*) as total
    FROM message msg
    JOIN member m ON msg.sender_id = m.id
    WHERE ${keywordCondition}
    ${timeCondition}
    ${senderCondition}
  `
  const totalRow = db.prepare(countSql).get(...keywordParams, ...timeParams, ...senderParams) as { total: number }
  const total = totalRow?.total || 0

  // Query messages
  const sql = `
    SELECT
      msg.id,
      m.id as senderId,
      COALESCE(m.group_nickname, m.account_name, m.platform_id) as senderName,
      m.platform_id as senderPlatformId,
      msg.content,
      msg.ts as timestamp,
      msg.type
    FROM message msg
    JOIN member m ON msg.sender_id = m.id
    WHERE ${keywordCondition}
    ${timeCondition}
    ${senderCondition}
    ORDER BY msg.ts DESC
    LIMIT ? OFFSET ?
  `

  const rows = db.prepare(sql).all(
    ...keywordParams, ...timeParams, ...senderParams, limit, offset
  ) as DbMessageRow[]

  return {
    messages: rows.map(sanitizeMessageRow),
    total,
  }
}

/**
 * Get recent messages (text only, for AI analysis)
 */
export function getRecentMessages(
  db: Database.Database,
  options?: { limit?: number; timeFilter?: TimeFilter }
): MessagesWithTotal {
  const limit = options?.limit ?? 100

  const { clause: timeClause, params: timeParams } = buildTimeFilter(options?.timeFilter, 'msg')
  const timeCondition = timeClause ? timeClause.replace('WHERE', 'AND') : ''

  // Count total
  const countSql = `
    SELECT COUNT(*) as total
    FROM message msg
    JOIN member m ON msg.sender_id = m.id
    WHERE 1=1
    ${timeCondition}
    ${SYSTEM_FILTER}
    ${TEXT_ONLY_FILTER}
  `
  const totalRow = db.prepare(countSql).get(...timeParams) as { total: number }
  const total = totalRow?.total || 0

  // Query recent messages (DESC then reverse for chronological order)
  const sql = `
    SELECT
      msg.id,
      m.id as senderId,
      COALESCE(m.group_nickname, m.account_name, m.platform_id) as senderName,
      m.platform_id as senderPlatformId,
      msg.content,
      msg.ts as timestamp,
      msg.type
    FROM message msg
    JOIN member m ON msg.sender_id = m.id
    WHERE 1=1
    ${timeCondition}
    ${SYSTEM_FILTER}
    ${TEXT_ONLY_FILTER}
    ORDER BY msg.ts DESC
    LIMIT ?
  `

  const rows = db.prepare(sql).all(...timeParams, limit) as DbMessageRow[]
  return {
    messages: rows.map(sanitizeMessageRow).reverse(),
    total,
  }
}

/**
 * Get message context (surrounding messages)
 */
export function getMessageContext(
  db: Database.Database,
  messageId: number,
  contextSize: number = 20
): MessageResult[] {
  const contextIds = new Set<number>()
  contextIds.add(messageId)

  // Get messages before
  const beforeRows = db.prepare(
    'SELECT id FROM message WHERE id < ? ORDER BY id DESC LIMIT ?'
  ).all(messageId, contextSize) as { id: number }[]
  beforeRows.forEach((row) => contextIds.add(row.id))

  // Get messages after
  const afterRows = db.prepare(
    'SELECT id FROM message WHERE id > ? ORDER BY id ASC LIMIT ?'
  ).all(messageId, contextSize) as { id: number }[]
  afterRows.forEach((row) => contextIds.add(row.id))

  if (contextIds.size === 0) return []

  const idList = Array.from(contextIds)
  const placeholders = idList.map(() => '?').join(', ')

  const sql = `
    SELECT
      msg.id,
      m.id as senderId,
      COALESCE(m.group_nickname, m.account_name, m.platform_id) as senderName,
      m.platform_id as senderPlatformId,
      msg.content,
      msg.ts as timestamp,
      msg.type
    FROM message msg
    JOIN member m ON msg.sender_id = m.id
    WHERE msg.id IN (${placeholders})
    ORDER BY msg.id ASC
  `

  const rows = db.prepare(sql).all(...idList) as DbMessageRow[]
  return rows.map(sanitizeMessageRow)
}

/**
 * Get conversation between two members
 */
export function getConversationBetween(
  db: Database.Database,
  memberId1: number,
  memberId2: number,
  options?: { limit?: number; timeFilter?: TimeFilter }
): MessagesWithTotal & { member1Name: string; member2Name: string } {
  const limit = options?.limit ?? 100

  // Get member names
  const getMemberName = (id: number) => {
    const row = db.prepare(
      "SELECT COALESCE(group_nickname, account_name, platform_id) as name FROM member WHERE id = ?"
    ).get(id) as { name: string } | undefined
    return row?.name || ''
  }

  const member1Name = getMemberName(memberId1)
  const member2Name = getMemberName(memberId2)

  if (!member1Name || !member2Name) {
    return { messages: [], total: 0, member1Name: '', member2Name: '' }
  }

  const { clause: timeClause, params: timeParams } = buildTimeFilter(options?.timeFilter, 'msg')
  const timeCondition = timeClause ? timeClause.replace('WHERE', 'AND') : ''

  // Count
  const countSql = `
    SELECT COUNT(*) as total
    FROM message msg
    JOIN member m ON msg.sender_id = m.id
    WHERE msg.sender_id IN (?, ?)
    ${timeCondition}
    AND msg.content IS NOT NULL AND msg.content != ''
  `
  const totalRow = db.prepare(countSql).get(memberId1, memberId2, ...timeParams) as { total: number }

  // Query
  const sql = `
    SELECT
      msg.id,
      m.id as senderId,
      COALESCE(m.group_nickname, m.account_name, m.platform_id) as senderName,
      m.platform_id as senderPlatformId,
      msg.content,
      msg.ts as timestamp,
      msg.type
    FROM message msg
    JOIN member m ON msg.sender_id = m.id
    WHERE msg.sender_id IN (?, ?)
    ${timeCondition}
    AND msg.content IS NOT NULL AND msg.content != ''
    ORDER BY msg.ts DESC
    LIMIT ?
  `

  const rows = db.prepare(sql).all(memberId1, memberId2, ...timeParams, limit) as DbMessageRow[]

  return {
    messages: rows.map(sanitizeMessageRow).reverse(),
    total: totalRow?.total || 0,
    member1Name,
    member2Name,
  }
}

/**
 * Get all members with message counts
 */
export function getMembers(db: Database.Database): MemberInfo[] {
  const rows = db.prepare(`
    SELECT
      m.id,
      m.platform_id as platformId,
      m.account_name as accountName,
      m.group_nickname as groupNickname,
      CASE WHEN EXISTS(SELECT 1 FROM pragma_table_info('member') WHERE name='aliases') THEN m.aliases ELSE NULL END as aliases,
      COUNT(msg.id) as messageCount
    FROM member m
    LEFT JOIN message msg ON m.id = msg.sender_id
    WHERE COALESCE(m.group_nickname, m.account_name, m.platform_id) != '系统消息'
    GROUP BY m.id
    ORDER BY messageCount DESC
  `).all() as Array<{
    id: number
    platformId: string
    accountName: string | null
    groupNickname: string | null
    aliases: string | null
    messageCount: number
  }>

  return rows.map((row) => ({
    id: row.id,
    platformId: row.platformId,
    accountName: row.accountName,
    groupNickname: row.groupNickname,
    aliases: row.aliases ? (() => { try { return JSON.parse(row.aliases!) } catch { return [] } })() : [],
    messageCount: row.messageCount,
  }))
}

/**
 * Get member activity ranking
 */
export function getMemberActivity(
  db: Database.Database,
  timeFilter?: TimeFilter
): MemberActivity[] {
  const { clause, params } = buildTimeFilter(timeFilter)
  const msgFilterBase = clause ? clause.replace('WHERE', 'AND') : ''
  const msgFilterWithSystem = msgFilterBase + " AND COALESCE(m.account_name, '') != '系统消息'"

  const totalClauseWithSystem = buildSystemMessageFilter(clause)
  const totalMessages = (
    db.prepare(
      `SELECT COUNT(*) as count
       FROM message msg
       JOIN member m ON msg.sender_id = m.id
       ${totalClauseWithSystem}`
    ).get(...params) as { count: number }
  ).count

  const rows = db.prepare(`
    SELECT
      m.id as memberId,
      m.platform_id as platformId,
      COALESCE(m.group_nickname, m.account_name, m.platform_id) as name,
      COUNT(msg.id) as messageCount
    FROM member m
    LEFT JOIN message msg ON m.id = msg.sender_id ${msgFilterWithSystem}
    WHERE COALESCE(m.account_name, '') != '系统消息'
    GROUP BY m.id
    HAVING messageCount > 0
    ORDER BY messageCount DESC
  `).all(...params) as Array<{
    memberId: number
    platformId: string
    name: string
    messageCount: number
  }>

  return rows.map((row) => ({
    memberId: row.memberId,
    platformId: row.platformId,
    name: row.name,
    messageCount: row.messageCount,
    percentage: totalMessages > 0 ? Math.round((row.messageCount / totalMessages) * 10000) / 100 : 0,
  }))
}

/**
 * Get hourly activity distribution
 */
export function getHourlyActivity(
  db: Database.Database,
  timeFilter?: TimeFilter
): HourlyActivity[] {
  const { clause, params } = buildTimeFilter(timeFilter)
  const clauseWithSystem = buildSystemMessageFilter(clause)

  const rows = db.prepare(`
    SELECT
      CAST(strftime('%H', msg.ts, 'unixepoch', 'localtime') AS INTEGER) as hour,
      COUNT(*) as messageCount
    FROM message msg
    JOIN member m ON msg.sender_id = m.id
    ${clauseWithSystem}
    GROUP BY hour
    ORDER BY hour
  `).all(...params) as Array<{ hour: number; messageCount: number }>

  const result: HourlyActivity[] = []
  for (let h = 0; h < 24; h++) {
    const found = rows.find((r) => r.hour === h)
    result.push({ hour: h, messageCount: found ? found.messageCount : 0 })
  }
  return result
}

/**
 * Get daily activity trend
 */
export function getDailyActivity(
  db: Database.Database,
  timeFilter?: TimeFilter
): DailyActivity[] {
  const { clause, params } = buildTimeFilter(timeFilter)
  const clauseWithSystem = buildSystemMessageFilter(clause)

  return db.prepare(`
    SELECT
      strftime('%Y-%m-%d', msg.ts, 'unixepoch', 'localtime') as date,
      COUNT(*) as messageCount
    FROM message msg
    JOIN member m ON msg.sender_id = m.id
    ${clauseWithSystem}
    GROUP BY date
    ORDER BY date
  `).all(...params) as DailyActivity[]
}

/**
 * Get weekday activity distribution
 */
export function getWeekdayActivity(
  db: Database.Database,
  timeFilter?: TimeFilter
): WeekdayActivity[] {
  const { clause, params } = buildTimeFilter(timeFilter)
  const clauseWithSystem = buildSystemMessageFilter(clause)

  const rows = db.prepare(`
    SELECT
      CASE
        WHEN CAST(strftime('%w', msg.ts, 'unixepoch', 'localtime') AS INTEGER) = 0 THEN 7
        ELSE CAST(strftime('%w', msg.ts, 'unixepoch', 'localtime') AS INTEGER)
      END as weekday,
      COUNT(*) as messageCount
    FROM message msg
    JOIN member m ON msg.sender_id = m.id
    ${clauseWithSystem}
    GROUP BY weekday
    ORDER BY weekday
  `).all(...params) as Array<{ weekday: number; messageCount: number }>

  const result: WeekdayActivity[] = []
  for (let w = 1; w <= 7; w++) {
    const found = rows.find((r) => r.weekday === w)
    result.push({ weekday: w, messageCount: found ? found.messageCount : 0 })
  }
  return result
}

/**
 * Get monthly activity distribution
 */
export function getMonthlyActivity(
  db: Database.Database,
  timeFilter?: TimeFilter
): MonthlyActivity[] {
  const { clause, params } = buildTimeFilter(timeFilter)
  const clauseWithSystem = buildSystemMessageFilter(clause)

  const rows = db.prepare(`
    SELECT
      CAST(strftime('%m', msg.ts, 'unixepoch', 'localtime') AS INTEGER) as month,
      COUNT(*) as messageCount
    FROM message msg
    JOIN member m ON msg.sender_id = m.id
    ${clauseWithSystem}
    GROUP BY month
    ORDER BY month
  `).all(...params) as Array<{ month: number; messageCount: number }>

  const result: MonthlyActivity[] = []
  for (let m = 1; m <= 12; m++) {
    const found = rows.find((r) => r.month === m)
    result.push({ month: m, messageCount: found ? found.messageCount : 0 })
  }
  return result
}

/**
 * Get member name history
 */
export function getMemberNameHistory(
  db: Database.Database,
  memberId: number
): NameHistoryEntry[] {
  return db.prepare(`
    SELECT name_type as nameType, name, start_ts as startTs, end_ts as endTs
    FROM member_name_history
    WHERE member_id = ?
    ORDER BY start_ts DESC
  `).all(memberId) as NameHistoryEntry[]
}

/**
 * Execute a read-only SQL query
 */
export function executeRawSQL(db: Database.Database, sql: string): SQLResult {
  const trimmedSQL = sql.trim()

  // Only allow SELECT statements
  if (!trimmedSQL.toUpperCase().startsWith('SELECT')) {
    throw new Error('Only SELECT queries are allowed')
  }

  const startTime = Date.now()

  const stmt = db.prepare(trimmedSQL)

  // Safety: enforce read-only
  if (!stmt.readonly) {
    throw new Error('Only read-only statements are allowed')
  }

  const rows = stmt.all()
  const duration = Date.now() - startTime
  const columns = stmt.columns().map((col) => col.name)
  const rowData = rows.map((row: any) => columns.map((col) => row[col]))

  return {
    columns,
    rows: rowData,
    rowCount: rows.length,
    duration,
  }
}

/**
 * Get database schema (tables and columns)
 */
export function getSchema(db: Database.Database): TableSchema[] {
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all() as { name: string }[]

  const schema: TableSchema[] = []

  for (const table of tables) {
    const columns = db.prepare(`PRAGMA table_info('${table.name}')`).all() as Array<{
      cid: number
      name: string
      type: string
      notnull: number
      dflt_value: unknown
      pk: number
    }>

    schema.push({
      name: table.name,
      columns: columns.map((col) => ({
        name: col.name,
        type: col.type,
        notnull: col.notnull === 1,
        pk: col.pk === 1,
      })),
    })
  }

  return schema
}
