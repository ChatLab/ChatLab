/**
 * 基础查询模块
 * 提供活跃度、时段分布等基础统计查询
 */

import Database from 'better-sqlite3'
import * as fs from 'fs'
import {
  openDatabase,
  closeDatabase,
  getDbPath,
  buildTimeFilter,
  buildSystemMessageFilter,
  type TimeFilter,
} from '../core'

// ==================== 基础查询 ====================

/**
 * 获取可用的年份列表
 */
export function getAvailableYears(sessionId: string): number[] {
  const db = openDatabase(sessionId)
  if (!db) return []

  const rows = db
    .prepare(
      `
      SELECT DISTINCT CAST(strftime('%Y', ts, 'unixepoch', 'localtime') AS INTEGER) as year
      FROM message
      ORDER BY year DESC
    `
    )
    .all() as Array<{ year: number }>

  return rows.map((r) => r.year)
}

/**
 * 获取成员活跃度排行
 */
export function getMemberActivity(sessionId: string, filter?: TimeFilter): any[] {
  // 先确保数据库有 avatar 字段（兼容旧数据库）
  ensureAvatarColumn(sessionId)

  const db = openDatabase(sessionId)
  if (!db) return []

  const { clause, params } = buildTimeFilter(filter)

  const msgFilterBase = clause ? clause.replace('WHERE', 'AND') : ''
  const msgFilterWithSystem = msgFilterBase + " AND COALESCE(m.account_name, '') != '系统消息'"

  const totalClauseWithSystem = buildSystemMessageFilter(clause)
  const totalMessages = (
    db
      .prepare(
        `SELECT COUNT(*) as count
         FROM message msg
         JOIN member m ON msg.sender_id = m.id
         ${totalClauseWithSystem}`
      )
      .get(...params) as { count: number }
  ).count

  const rows = db
    .prepare(
      `
      SELECT
        m.id as memberId,
        m.platform_id as platformId,
        COALESCE(m.group_nickname, m.account_name, m.platform_id) as name,
        m.avatar as avatar,
        COUNT(msg.id) as messageCount
      FROM member m
      LEFT JOIN message msg ON m.id = msg.sender_id ${msgFilterWithSystem}
      WHERE COALESCE(m.account_name, '') != '系统消息'
      GROUP BY m.id
      HAVING messageCount > 0
      ORDER BY messageCount DESC
    `
    )
    .all(...params) as Array<{
    memberId: number
    platformId: string
    name: string
    avatar: string | null
    messageCount: number
  }>

  return rows.map((row) => ({
    memberId: row.memberId,
    platformId: row.platformId,
    name: row.name,
    avatar: row.avatar,
    messageCount: row.messageCount,
    percentage: totalMessages > 0 ? Math.round((row.messageCount / totalMessages) * 10000) / 100 : 0,
  }))
}

/**
 * 获取每小时活跃度分布
 */
export function getHourlyActivity(sessionId: string, filter?: TimeFilter): any[] {
  const db = openDatabase(sessionId)
  if (!db) return []

  const { clause, params } = buildTimeFilter(filter)
  const clauseWithSystem = buildSystemMessageFilter(clause)

  const rows = db
    .prepare(
      `
      SELECT
        CAST(strftime('%H', msg.ts, 'unixepoch', 'localtime') AS INTEGER) as hour,
        COUNT(*) as messageCount
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${clauseWithSystem}
      GROUP BY hour
      ORDER BY hour
    `
    )
    .all(...params) as Array<{ hour: number; messageCount: number }>

  const result: any[] = []
  for (let h = 0; h < 24; h++) {
    const found = rows.find((r) => r.hour === h)
    result.push({
      hour: h,
      messageCount: found ? found.messageCount : 0,
    })
  }

  return result
}

/**
 * 获取每日活跃度趋势
 */
export function getDailyActivity(sessionId: string, filter?: TimeFilter): any[] {
  const db = openDatabase(sessionId)
  if (!db) return []

  const { clause, params } = buildTimeFilter(filter)
  const clauseWithSystem = buildSystemMessageFilter(clause)

  const rows = db
    .prepare(
      `
      SELECT
        strftime('%Y-%m-%d', msg.ts, 'unixepoch', 'localtime') as date,
        COUNT(*) as messageCount
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${clauseWithSystem}
      GROUP BY date
      ORDER BY date
    `
    )
    .all(...params) as Array<{ date: string; messageCount: number }>

  return rows
}

/**
 * 获取星期活跃度分布
 */
export function getWeekdayActivity(sessionId: string, filter?: TimeFilter): any[] {
  const db = openDatabase(sessionId)
  if (!db) return []

  const { clause, params } = buildTimeFilter(filter)
  const clauseWithSystem = buildSystemMessageFilter(clause)

  const rows = db
    .prepare(
      `
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
    `
    )
    .all(...params) as Array<{ weekday: number; messageCount: number }>

  const result: any[] = []
  for (let w = 1; w <= 7; w++) {
    const found = rows.find((r) => r.weekday === w)
    result.push({
      weekday: w,
      messageCount: found ? found.messageCount : 0,
    })
  }

  return result
}

/**
 * 获取月份活跃度分布
 */
export function getMonthlyActivity(sessionId: string, filter?: TimeFilter): any[] {
  const db = openDatabase(sessionId)
  if (!db) return []

  const { clause, params } = buildTimeFilter(filter)
  const clauseWithSystem = buildSystemMessageFilter(clause)

  const rows = db
    .prepare(
      `
      SELECT
        CAST(strftime('%m', msg.ts, 'unixepoch', 'localtime') AS INTEGER) as month,
        COUNT(*) as messageCount
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${clauseWithSystem}
      GROUP BY month
      ORDER BY month
    `
    )
    .all(...params) as Array<{ month: number; messageCount: number }>

  const result: any[] = []
  for (let m = 1; m <= 12; m++) {
    const found = rows.find((r) => r.month === m)
    result.push({
      month: m,
      messageCount: found ? found.messageCount : 0,
    })
  }

  return result
}

/**
 * 获取年份活跃度分布
 */
export function getYearlyActivity(sessionId: string, filter?: TimeFilter): any[] {
  const db = openDatabase(sessionId)
  if (!db) return []

  const { clause, params } = buildTimeFilter(filter)
  const clauseWithSystem = buildSystemMessageFilter(clause)

  const rows = db
    .prepare(
      `
      SELECT
        CAST(strftime('%Y', msg.ts, 'unixepoch', 'localtime') AS INTEGER) as year,
        COUNT(*) as messageCount
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${clauseWithSystem}
      GROUP BY year
      ORDER BY year
    `
    )
    .all(...params) as Array<{ year: number; messageCount: number }>

  return rows.map((r) => ({
    year: r.year,
    messageCount: r.messageCount,
  }))
}

/**
 * 获取消息类型分布
 */
export function getMessageTypeDistribution(sessionId: string, filter?: TimeFilter): any[] {
  const db = openDatabase(sessionId)
  if (!db) return []

  const { clause, params } = buildTimeFilter(filter)
  const clauseWithSystem = buildSystemMessageFilter(clause)

  const rows = db
    .prepare(
      `
      SELECT msg.type, COUNT(*) as count
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${clauseWithSystem}
      GROUP BY msg.type
      ORDER BY count DESC
    `
    )
    .all(...params) as Array<{ type: number; count: number }>

  return rows.map((r) => ({
    type: r.type,
    count: r.count,
  }))
}

/**
 * 获取消息长度分布（仅统计文字消息）
 * 返回两组数据：
 * - detail: 1-25 字逐字分布
 * - grouped: 5-100+ 每5字一组
 */
export function getMessageLengthDistribution(
  sessionId: string,
  filter?: TimeFilter
): {
  detail: Array<{ len: number; count: number }>
  grouped: Array<{ range: string; count: number }>
} {
  const db = openDatabase(sessionId)
  if (!db) return { detail: [], grouped: [] }

  const { clause, params } = buildTimeFilter(filter)
  const clauseWithSystem = buildSystemMessageFilter(clause)

  // 只统计文字消息 (type = 0)，并且 content 不为空
  const typeCondition = clauseWithSystem
    ? clauseWithSystem + ' AND msg.type = 0 AND msg.content IS NOT NULL AND LENGTH(msg.content) > 0'
    : 'WHERE msg.type = 0 AND msg.content IS NOT NULL AND LENGTH(msg.content) > 0'

  // 直接获取每条消息的长度
  const rows = db
    .prepare(
      `
      SELECT LENGTH(msg.content) as len, COUNT(*) as count
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${typeCondition}
      GROUP BY len
      ORDER BY len
    `
    )
    .all(...params) as Array<{ len: number; count: number }>

  // 构建 detail：1-25 逐字
  const detail: Array<{ len: number; count: number }> = []
  for (let i = 1; i <= 25; i++) {
    const found = rows.find((r) => r.len === i)
    detail.push({
      len: i,
      count: found ? found.count : 0,
    })
  }

  // 构建 grouped：每5字一段
  const ranges5 = [
    { min: 1, max: 5, label: '1-5' },
    { min: 6, max: 10, label: '6-10' },
    { min: 11, max: 15, label: '11-15' },
    { min: 16, max: 20, label: '16-20' },
    { min: 21, max: 25, label: '21-25' },
    { min: 26, max: 30, label: '26-30' },
    { min: 31, max: 35, label: '31-35' },
    { min: 36, max: 40, label: '36-40' },
    { min: 41, max: 45, label: '41-45' },
    { min: 46, max: 50, label: '46-50' },
    { min: 51, max: 60, label: '51-60' },
    { min: 61, max: 70, label: '61-70' },
    { min: 71, max: 80, label: '71-80' },
    { min: 81, max: 100, label: '81-100' },
    { min: 101, max: Infinity, label: '100+' },
  ]

  const grouped: Array<{ range: string; count: number }> = []
  for (const r of ranges5) {
    const count = rows.filter((row) => row.len >= r.min && row.len <= r.max).reduce((sum, row) => sum + row.count, 0)
    grouped.push({
      range: r.label,
      count,
    })
  }

  return { detail, grouped }
}

/**
 * 获取时间范围
 */
export function getTimeRange(sessionId: string): { start: number; end: number } | null {
  const db = openDatabase(sessionId)
  if (!db) return null

  const row = db
    .prepare(
      `
      SELECT MIN(ts) as start, MAX(ts) as end FROM message
    `
    )
    .get() as { start: number | null; end: number | null }

  if (row.start === null || row.end === null) return null

  return { start: row.start, end: row.end }
}

/**
 * 获取成员的历史昵称记录
 */
export function getMemberNameHistory(sessionId: string, memberId: number): any[] {
  const db = openDatabase(sessionId)
  if (!db) return []

  const rows = db
    .prepare(
      `
      SELECT name_type as nameType, name, start_ts as startTs, end_ts as endTs
      FROM member_name_history
      WHERE member_id = ?
      ORDER BY start_ts DESC
    `
    )
    .all(memberId) as Array<{ nameType: string; name: string; startTs: number; endTs: number | null }>

  return rows
}

// ==================== 成员管理 ====================

/**
 * 成员信息（含统计数据）
 */
interface MemberWithStats {
  id: number
  platformId: string
  accountName: string | null
  groupNickname: string | null
  aliases: string[]
  messageCount: number
  avatar: string | null
}

// 用于标记已检查过 aliases 字段的会话
const aliasesCheckedSessions = new Set<string>()
// 用于标记已检查过 avatar 字段的会话
const avatarCheckedSessions = new Set<string>()

/**
 * 确保 member 表有 aliases 字段（数据库迁移）
 * 用于兼容旧数据库
 */
function ensureAliasesColumn(sessionId: string): void {
  // 每个会话只检查一次
  if (aliasesCheckedSessions.has(sessionId)) return

  const dbPath = getDbPath(sessionId)
  if (!fs.existsSync(dbPath)) return

  // 先关闭可能缓存的只读连接
  closeDatabase(sessionId)

  // 使用写入模式打开数据库检查并添加字段
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')

  try {
    // 检查 aliases 字段是否存在
    const columns = db.prepare('PRAGMA table_info(member)').all() as Array<{ name: string }>
    const hasAliases = columns.some((col) => col.name === 'aliases')

    if (!hasAliases) {
      // 添加 aliases 字段
      db.exec("ALTER TABLE member ADD COLUMN aliases TEXT DEFAULT '[]'")
      console.log(`[Worker] Added aliases column to member table in session ${sessionId}`)
    }

    // 标记为已检查
    aliasesCheckedSessions.add(sessionId)
  } finally {
    db.close()
  }
}

/**
 * 确保 member 表有 avatar 字段（数据库迁移）
 * 用于兼容旧数据库
 */
export function ensureAvatarColumn(sessionId: string): void {
  // 每个会话只检查一次
  if (avatarCheckedSessions.has(sessionId)) return

  const dbPath = getDbPath(sessionId)
  if (!fs.existsSync(dbPath)) return

  // 先关闭可能缓存的只读连接
  closeDatabase(sessionId)

  // 使用写入模式打开数据库检查并添加字段
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')

  try {
    // 检查 avatar 字段是否存在
    const columns = db.prepare('PRAGMA table_info(member)').all() as Array<{ name: string }>
    const hasAvatar = columns.some((col) => col.name === 'avatar')

    if (!hasAvatar) {
      // 添加 avatar 字段
      db.exec('ALTER TABLE member ADD COLUMN avatar TEXT')
      console.log(`[Worker] Added avatar column to member table in session ${sessionId}`)
    }

    // 标记为已检查
    avatarCheckedSessions.add(sessionId)
  } finally {
    db.close()
  }
}

/**
 * 获取所有成员列表（含消息数、别名和头像）
 */
export function getMembers(sessionId: string): MemberWithStats[] {
  // 先确保数据库有 aliases 和 avatar 字段（兼容旧数据库）
  ensureAliasesColumn(sessionId)
  ensureAvatarColumn(sessionId)

  const db = openDatabase(sessionId)
  if (!db) return []

  const rows = db
    .prepare(
      `
      SELECT
        m.id,
        m.platform_id as platformId,
        m.account_name as accountName,
        m.group_nickname as groupNickname,
        m.aliases,
        m.avatar,
        COUNT(msg.id) as messageCount
      FROM member m
      LEFT JOIN message msg ON m.id = msg.sender_id
      WHERE COALESCE(m.group_nickname, m.account_name, m.platform_id) != '系统消息'
      GROUP BY m.id
      ORDER BY messageCount DESC
    `
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

  return rows.map((row) => ({
    id: row.id,
    platformId: row.platformId,
    accountName: row.accountName,
    groupNickname: row.groupNickname,
    aliases: row.aliases ? JSON.parse(row.aliases) : [],
    messageCount: row.messageCount,
    avatar: row.avatar,
  }))
}

/**
 * 分页参数类型
 */
export interface MembersPaginationParams {
  page: number
  pageSize: number
  search?: string
  sortOrder?: 'asc' | 'desc'
}

/**
 * 分页结果类型
 */
export interface MembersPaginatedResult {
  members: MemberWithStats[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

/**
 * 获取成员列表（分页版本，支持搜索和排序）
 */
export function getMembersPaginated(sessionId: string, params: MembersPaginationParams): MembersPaginatedResult {
  const { page = 1, pageSize = 20, search = '', sortOrder = 'desc' } = params

  // 先确保数据库有 aliases 和 avatar 字段（兼容旧数据库）
  ensureAliasesColumn(sessionId)
  ensureAvatarColumn(sessionId)

  const db = openDatabase(sessionId)
  if (!db) {
    return { members: [], total: 0, page, pageSize, totalPages: 0 }
  }

  // 构建搜索条件
  const searchCondition = search
    ? `AND (
        m.group_nickname LIKE '%' || @search || '%' COLLATE NOCASE
        OR m.account_name LIKE '%' || @search || '%' COLLATE NOCASE
        OR m.platform_id LIKE '%' || @search || '%' COLLATE NOCASE
        OR m.aliases LIKE '%' || @search || '%' COLLATE NOCASE
      )`
    : ''

  // 排序方向
  const orderDirection = sortOrder === 'asc' ? 'ASC' : 'DESC'

  // 计算总数
  const countResult = db
    .prepare(
      `
      SELECT COUNT(*) as total FROM (
        SELECT m.id
        FROM member m
        LEFT JOIN message msg ON m.id = msg.sender_id
        WHERE COALESCE(m.group_nickname, m.account_name, m.platform_id) != '系统消息'
        ${searchCondition}
        GROUP BY m.id
      )
    `
    )
    .get({ search }) as { total: number }

  const total = countResult?.total || 0
  const totalPages = Math.ceil(total / pageSize)
  const offset = (page - 1) * pageSize

  // 查询分页数据
  const rows = db
    .prepare(
      `
      SELECT
        m.id,
        m.platform_id as platformId,
        m.account_name as accountName,
        m.group_nickname as groupNickname,
        m.aliases,
        m.avatar,
        COUNT(msg.id) as messageCount
      FROM member m
      LEFT JOIN message msg ON m.id = msg.sender_id
      WHERE COALESCE(m.group_nickname, m.account_name, m.platform_id) != '系统消息'
      ${searchCondition}
      GROUP BY m.id
      ORDER BY messageCount ${orderDirection}
      LIMIT @pageSize OFFSET @offset
    `
    )
    .all({ search, pageSize, offset }) as Array<{
    id: number
    platformId: string
    accountName: string | null
    groupNickname: string | null
    aliases: string | null
    avatar: string | null
    messageCount: number
  }>

  const members = rows.map((row) => ({
    id: row.id,
    platformId: row.platformId,
    accountName: row.accountName,
    groupNickname: row.groupNickname,
    aliases: row.aliases ? JSON.parse(row.aliases) : [],
    messageCount: row.messageCount,
    avatar: row.avatar,
  }))

  return { members, total, page, pageSize, totalPages }
}

/**
 * 更新成员别名
 */
export function updateMemberAliases(sessionId: string, memberId: number, aliases: string[]): boolean {
  const dbPath = getDbPath(sessionId)
  if (!fs.existsSync(dbPath)) {
    return false
  }

  try {
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')

    const stmt = db.prepare('UPDATE member SET aliases = ? WHERE id = ?')
    stmt.run(JSON.stringify(aliases), memberId)

    db.close()
    return true
  } catch (error) {
    console.error('[Worker] Failed to update member aliases:', error)
    return false
  }
}

/**
 * 删除成员及其所有消息
 */
export function deleteMember(sessionId: string, memberId: number): boolean {
  const dbPath = getDbPath(sessionId)
  if (!fs.existsSync(dbPath)) {
    return false
  }

  try {
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')

    // 使用事务删除成员及其相关数据
    const deleteTransaction = db.transaction(() => {
      // 1. 删除该成员的消息
      db.prepare('DELETE FROM message WHERE sender_id = ?').run(memberId)

      // 2. 删除该成员的昵称历史
      db.prepare('DELETE FROM member_name_history WHERE member_id = ?').run(memberId)

      // 3. 删除成员记录
      db.prepare('DELETE FROM member WHERE id = ?').run(memberId)
    })

    deleteTransaction()
    db.close()
    return true
  } catch (error) {
    console.error('[Worker] Failed to delete member:', error)
    return false
  }
}
