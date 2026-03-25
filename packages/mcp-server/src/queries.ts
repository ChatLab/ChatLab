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

// ==================== Session Overview ====================

const MESSAGE_TYPE_NAMES: Record<number, string> = {
  0: 'text', 1: 'image', 2: 'voice', 3: 'video',
  4: 'file', 5: 'emoji', 7: 'link', 8: 'location',
  20: 'redPacket', 21: 'transfer', 22: 'poke', 23: 'call',
  24: 'share', 25: 'reply', 26: 'forward', 27: 'contact',
  80: 'system', 81: 'recall', 99: 'other',
}

export interface SessionOverview {
  totalMessages: number
  totalMembers: number
  timeRange: { start: number; end: number } | null
  messageTypes: Array<{ type: number; typeName: string; count: number }>
  topMembers: Array<{ name: string; messageCount: number; percentage: number }>
}

/**
 * Get comprehensive session overview
 */
export function getSessionOverview(db: Database.Database): SessionOverview {
  const msgCount = db.prepare('SELECT COUNT(*) as count FROM message').get() as { count: number }
  const memberCount = db.prepare(
    "SELECT COUNT(*) as count FROM member WHERE COALESCE(group_nickname, account_name, platform_id) != '系统消息'"
  ).get() as { count: number }
  const timeRange = db.prepare('SELECT MIN(ts) as start, MAX(ts) as end FROM message').get() as {
    start: number | null; end: number | null
  }

  // Message type distribution
  const typeRows = db.prepare(
    'SELECT type, COUNT(*) as count FROM message GROUP BY type ORDER BY count DESC'
  ).all() as Array<{ type: number; count: number }>

  const messageTypes = typeRows.map((r) => ({
    type: r.type,
    typeName: MESSAGE_TYPE_NAMES[r.type] || `type_${r.type}`,
    count: r.count,
  }))

  // Top 5 members
  const activity = getMemberActivity(db)
  const topMembers = activity.slice(0, 5).map((m) => ({
    name: m.name,
    messageCount: m.messageCount,
    percentage: m.percentage,
  }))

  return {
    totalMessages: msgCount.count,
    totalMembers: memberCount.count,
    timeRange: timeRange.start !== null && timeRange.end !== null
      ? { start: timeRange.start, end: timeRange.end }
      : null,
    messageTypes,
    topMembers,
  }
}

// ==================== Word Frequency ====================

export interface WordFrequencyResult {
  words: Array<{ word: string; count: number }>
  totalWords: number
  uniqueWords: number
}

// CJK Unicode range detection
const CJK_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/

/**
 * Get word frequency analysis (lightweight, no native NLP dependency)
 */
export function getWordFrequency(
  db: Database.Database,
  options?: { topN?: number; minCount?: number }
): WordFrequencyResult {
  const topN = options?.topN ?? 50
  const minCount = options?.minCount ?? 3

  // Fetch text messages
  const rows = db.prepare(
    "SELECT content FROM message WHERE type = 0 AND content IS NOT NULL AND content != '' LIMIT 50000"
  ).all() as Array<{ content: string }>

  const wordCounts = new Map<string, number>()
  let totalWords = 0

  for (const row of rows) {
    const text = row.content.trim()
    if (!text) continue

    // Check if text is primarily CJK
    const hasCJK = CJK_REGEX.test(text)

    if (hasCJK) {
      // CJK: extract 2-char and 3-char n-grams (skip punctuation/whitespace)
      const clean = text.replace(/[\s\p{P}\p{S}\p{N}]/gu, '')
      for (let len = 2; len <= 3; len++) {
        for (let i = 0; i <= clean.length - len; i++) {
          const gram = clean.slice(i, i + len)
          // Only include n-grams where all chars are CJK
          if ([...gram].every((ch) => CJK_REGEX.test(ch))) {
            wordCounts.set(gram, (wordCounts.get(gram) || 0) + 1)
            totalWords++
          }
        }
      }
    } else {
      // Non-CJK: split by whitespace/punctuation
      const words = text.toLowerCase().split(/[\s\p{P}]+/u).filter((w) => w.length >= 2)
      for (const word of words) {
        wordCounts.set(word, (wordCounts.get(word) || 0) + 1)
        totalWords++
      }
    }
  }

  // Filter and sort
  const sorted = [...wordCounts.entries()]
    .filter(([, count]) => count >= minCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)

  return {
    words: sorted.map(([word, count]) => ({ word, count })),
    totalWords,
    uniqueWords: wordCounts.size,
  }
}

// ==================== Date Range Messages ====================

export interface DateRangeMessagesResult extends MessagesWithTotal {
  startDate: string
  endDate: string
}

/**
 * Get messages within a date range (YYYY-MM-DD)
 */
export function getDateRangeMessages(
  db: Database.Database,
  startDate: string,
  endDate: string,
  options?: { senderId?: number; limit?: number }
): DateRangeMessagesResult {
  const limit = options?.limit ?? 200
  // Convert dates to unix seconds (start of day / end of day local time)
  const startTs = Math.floor(new Date(startDate + 'T00:00:00').getTime() / 1000)
  const endTs = Math.floor(new Date(endDate + 'T23:59:59').getTime() / 1000)

  const senderCondition = options?.senderId !== undefined ? 'AND msg.sender_id = ?' : ''
  const senderParams: number[] = options?.senderId !== undefined ? [options.senderId] : []

  const countSql = `
    SELECT COUNT(*) as total
    FROM message msg
    JOIN member m ON msg.sender_id = m.id
    WHERE msg.ts >= ? AND msg.ts <= ?
    ${senderCondition}
    ${SYSTEM_FILTER}
    ${TEXT_ONLY_FILTER}
  `
  const totalRow = db.prepare(countSql).get(startTs, endTs, ...senderParams) as { total: number }

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
    WHERE msg.ts >= ? AND msg.ts <= ?
    ${senderCondition}
    ${SYSTEM_FILTER}
    ${TEXT_ONLY_FILTER}
    ORDER BY msg.ts ASC
    LIMIT ?
  `

  const rows = db.prepare(sql).all(startTs, endTs, ...senderParams, limit) as DbMessageRow[]

  return {
    messages: rows.map(sanitizeMessageRow),
    total: totalRow?.total || 0,
    startDate,
    endDate,
  }
}

// ==================== Member Profile ====================

export interface MessageTypeCount {
  type: number
  typeName: string
  count: number
}

export interface MemberProfile {
  memberId: number
  name: string
  totalMessages: number
  percentage: number
  avgMessageLength: number
  messageTypes: MessageTypeCount[]
  peakHour: number | null
  topWords: Array<{ word: string; count: number }>
}

const MESSAGE_TYPE_NAMES_MAP = MESSAGE_TYPE_NAMES

/**
 * Get comprehensive profile for a specific member
 */
export function getMemberProfile(db: Database.Database, memberId: number): MemberProfile | null {
  // Basic member info
  const memberRow = db.prepare(
    "SELECT COALESCE(group_nickname, account_name, platform_id) as name FROM member WHERE id = ?"
  ).get(memberId) as { name: string } | undefined

  if (!memberRow) return null

  // Total messages and avg length
  const statsRow = db.prepare(`
    SELECT COUNT(*) as total, AVG(LENGTH(COALESCE(content, ''))) as avgLen
    FROM message WHERE sender_id = ?
  `).get(memberId) as { total: number; avgLen: number | null }

  // Total messages in session (for percentage)
  const totalRow = db.prepare(
    "SELECT COUNT(*) as count FROM message JOIN member m ON message.sender_id = m.id WHERE COALESCE(m.account_name, '') != '系统消息'"
  ).get() as { count: number }

  // Message type distribution
  const typeRows = db.prepare(`
    SELECT type, COUNT(*) as count FROM message WHERE sender_id = ? GROUP BY type ORDER BY count DESC
  `).all(memberId) as Array<{ type: number; count: number }>

  const messageTypes: MessageTypeCount[] = typeRows.map((r) => ({
    type: r.type,
    typeName: MESSAGE_TYPE_NAMES_MAP[r.type] || `type_${r.type}`,
    count: r.count,
  }))

  // Peak hour
  const peakHourRow = db.prepare(`
    SELECT CAST(strftime('%H', ts, 'unixepoch', 'localtime') AS INTEGER) as hour, COUNT(*) as cnt
    FROM message WHERE sender_id = ? GROUP BY hour ORDER BY cnt DESC LIMIT 1
  `).get(memberId) as { hour: number; cnt: number } | undefined

  // Top words from this member's text messages
  const textRows = db.prepare(
    "SELECT content FROM message WHERE sender_id = ? AND type = 0 AND content IS NOT NULL AND content != '' LIMIT 20000"
  ).all(memberId) as Array<{ content: string }>

  const wordCounts = new Map<string, number>()
  for (const row of textRows) {
    const text = row.content.trim()
    if (!text) continue
    const hasCJK = CJK_REGEX.test(text)
    if (hasCJK) {
      const clean = text.replace(/[\s\p{P}\p{S}\p{N}]/gu, '')
      for (let len = 2; len <= 3; len++) {
        for (let i = 0; i <= clean.length - len; i++) {
          const gram = clean.slice(i, i + len)
          if ([...gram].every((ch) => CJK_REGEX.test(ch))) {
            wordCounts.set(gram, (wordCounts.get(gram) || 0) + 1)
          }
        }
      }
    } else {
      const words = text.toLowerCase().split(/[\s\p{P}]+/u).filter((w) => w.length >= 2)
      for (const word of words) {
        wordCounts.set(word, (wordCounts.get(word) || 0) + 1)
      }
    }
  }

  const topWords = [...wordCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word, count]) => ({ word, count }))

  const total = statsRow?.total || 0
  const sessionTotal = totalRow?.count || 0

  return {
    memberId,
    name: memberRow.name,
    totalMessages: total,
    percentage: sessionTotal > 0 ? Math.round((total / sessionTotal) * 10000) / 100 : 0,
    avgMessageLength: Math.round((statsRow?.avgLen || 0) * 10) / 10,
    messageTypes,
    peakHour: peakHourRow?.hour ?? null,
    topWords,
  }
}

// ==================== Interaction Frequency ====================

export interface InteractionPair {
  member1Id: number
  member1Name: string
  member2Id: number
  member2Name: string
  exchangeCount: number
}

/**
 * Get interaction frequency between member pairs (consecutive message exchanges)
 */
export function getInteractionFrequency(
  db: Database.Database,
  topN: number = 10
): InteractionPair[] {
  // Count interactions: A speaks, B responds within 5 minutes (300 seconds), either direction
  const rows = db.prepare(`
    SELECT
      CASE WHEN a.sender_id < b.sender_id THEN a.sender_id ELSE b.sender_id END as member1,
      CASE WHEN a.sender_id < b.sender_id THEN b.sender_id ELSE a.sender_id END as member2,
      COUNT(*) as exchange_count
    FROM message a
    JOIN message b
      ON b.sender_id != a.sender_id
      AND b.ts > a.ts
      AND b.ts <= a.ts + 300
    WHERE a.type = 0 AND b.type = 0
      AND a.content IS NOT NULL AND a.content != ''
      AND b.content IS NOT NULL AND b.content != ''
    GROUP BY member1, member2
    ORDER BY exchange_count DESC
    LIMIT ?
  `).all(topN) as Array<{ member1: number; member2: number; exchange_count: number }>

  const getName = (id: number): string => {
    const row = db.prepare(
      "SELECT COALESCE(group_nickname, account_name, platform_id) as name FROM member WHERE id = ?"
    ).get(id) as { name: string } | undefined
    return row?.name || String(id)
  }

  return rows.map((r) => ({
    member1Id: r.member1,
    member1Name: getName(r.member1),
    member2Id: r.member2,
    member2Name: getName(r.member2),
    exchangeCount: r.exchange_count,
  }))
}

// ==================== Schema ====================

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
