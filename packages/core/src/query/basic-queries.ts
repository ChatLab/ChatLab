/**
 * 基础统计查询模块（平台无关）
 *
 * 提供活跃度排行、时段分布等核心统计查询。
 * 所有函数接收 DatabaseAdapter 参数，不依赖全局状态。
 */

import type { TimeFilter } from '@openchatlab/shared-types'
import type { DatabaseAdapter } from '../interfaces'
import { buildTimeFilter, buildSystemMessageFilter } from './filters'

export interface MemberActivity {
  memberId: number
  platformId: string
  name: string
  avatar: string | null
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

export interface YearlyActivity {
  year: number
  messageCount: number
}

export interface MessageLengthDistribution {
  detail: Array<{ len: number; count: number }>
  grouped: Array<{ range: string; count: number }>
}

export interface MessageTypeStats {
  type: number
  count: number
}

export interface TextStats {
  textCount: number
  avgLength: number
  maxLength: number
  shortCount: number
}

export interface TextLengthPercentiles {
  p25: number
  p50: number
  p75: number
  p90: number
}

export interface MemberMonthlyTrend {
  month: string
  memberId: number
  memberName: string
  count: number
}

/**
 * 获取消息时间范围
 */
export function getTimeRange(db: DatabaseAdapter): { start: number; end: number } | null {
  const row = db.prepare('SELECT MIN(ts) as start, MAX(ts) as end FROM message').get() as
    | { start: number | null; end: number | null }
    | undefined
  if (!row || row.start == null || row.end == null) return null
  return { start: row.start, end: row.end }
}

/**
 * 获取可用的年份列表
 */
export function getAvailableYears(db: DatabaseAdapter): number[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT CAST(strftime('%Y', ts, 'unixepoch', 'localtime') AS INTEGER) as year
       FROM message
       ORDER BY year DESC`
    )
    .all() as Array<{ year: number }>

  return rows.map((r) => r.year)
}

/**
 * 获取成员活跃度排行
 */
export function getMemberActivity(db: DatabaseAdapter, filter?: TimeFilter): MemberActivity[] {
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
      `SELECT
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
      ORDER BY messageCount DESC`
    )
    .all(...params) as Array<{
    memberId: number
    platformId: string
    name: string
    avatar: string | null
    messageCount: number
  }>

  return rows.map((row) => ({
    ...row,
    percentage: totalMessages > 0 ? Math.round((row.messageCount / totalMessages) * 10000) / 100 : 0,
  }))
}

/**
 * 获取每小时活跃度分布
 */
export function getHourlyActivity(db: DatabaseAdapter, filter?: TimeFilter): HourlyActivity[] {
  const { clause, params } = buildTimeFilter(filter)
  const clauseWithSystem = buildSystemMessageFilter(clause)

  const rows = db
    .prepare(
      `SELECT
        CAST(strftime('%H', msg.ts, 'unixepoch', 'localtime') AS INTEGER) as hour,
        COUNT(*) as messageCount
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${clauseWithSystem}
      GROUP BY hour
      ORDER BY hour`
    )
    .all(...params) as Array<{ hour: number; messageCount: number }>

  const result: HourlyActivity[] = []
  for (let h = 0; h < 24; h++) {
    const found = rows.find((r) => r.hour === h)
    result.push({ hour: h, messageCount: found ? found.messageCount : 0 })
  }
  return result
}

/**
 * 获取每日活跃度趋势
 */
export function getDailyActivity(db: DatabaseAdapter, filter?: TimeFilter): DailyActivity[] {
  const { clause, params } = buildTimeFilter(filter)
  const clauseWithSystem = buildSystemMessageFilter(clause)

  return db
    .prepare(
      `SELECT
        strftime('%Y-%m-%d', msg.ts, 'unixepoch', 'localtime') as date,
        COUNT(*) as messageCount
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${clauseWithSystem}
      GROUP BY date
      ORDER BY date`
    )
    .all(...params) as unknown as DailyActivity[]
}

/**
 * 获取星期活跃度分布
 */
export function getWeekdayActivity(db: DatabaseAdapter, filter?: TimeFilter): WeekdayActivity[] {
  const { clause, params } = buildTimeFilter(filter)
  const clauseWithSystem = buildSystemMessageFilter(clause)

  const rows = db
    .prepare(
      `SELECT
        CASE
          WHEN CAST(strftime('%w', msg.ts, 'unixepoch', 'localtime') AS INTEGER) = 0 THEN 7
          ELSE CAST(strftime('%w', msg.ts, 'unixepoch', 'localtime') AS INTEGER)
        END as weekday,
        COUNT(*) as messageCount
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${clauseWithSystem}
      GROUP BY weekday
      ORDER BY weekday`
    )
    .all(...params) as Array<{ weekday: number; messageCount: number }>

  const result: WeekdayActivity[] = []
  for (let w = 1; w <= 7; w++) {
    const found = rows.find((r) => r.weekday === w)
    result.push({ weekday: w, messageCount: found ? found.messageCount : 0 })
  }
  return result
}

/**
 * 获取消息类型分布
 */
export function getMessageTypeStats(db: DatabaseAdapter, filter?: TimeFilter): MessageTypeStats[] {
  const { clause, params } = buildTimeFilter(filter)
  const clauseWithSystem = buildSystemMessageFilter(clause)

  return db
    .prepare(
      `SELECT
        msg.type as type,
        COUNT(*) as count
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${clauseWithSystem}
      GROUP BY msg.type
      ORDER BY count DESC`
    )
    .all(...params) as unknown as MessageTypeStats[]
}

/**
 * 获取月份活跃度分布
 */
export function getMonthlyActivity(db: DatabaseAdapter, filter?: TimeFilter): MonthlyActivity[] {
  const { clause, params } = buildTimeFilter(filter)
  const clauseWithSystem = buildSystemMessageFilter(clause)

  const rows = db
    .prepare(
      `SELECT
        CAST(strftime('%m', msg.ts, 'unixepoch', 'localtime') AS INTEGER) as month,
        COUNT(*) as messageCount
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${clauseWithSystem}
      GROUP BY month
      ORDER BY month`
    )
    .all(...params) as Array<{ month: number; messageCount: number }>

  const result: MonthlyActivity[] = []
  for (let m = 1; m <= 12; m++) {
    const found = rows.find((r) => r.month === m)
    result.push({ month: m, messageCount: found ? found.messageCount : 0 })
  }
  return result
}

/**
 * 获取年份活跃度分布
 */
export function getYearlyActivity(db: DatabaseAdapter, filter?: TimeFilter): YearlyActivity[] {
  const { clause, params } = buildTimeFilter(filter)
  const clauseWithSystem = buildSystemMessageFilter(clause)

  return db
    .prepare(
      `SELECT
        CAST(strftime('%Y', msg.ts, 'unixepoch', 'localtime') AS INTEGER) as year,
        COUNT(*) as messageCount
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${clauseWithSystem}
      GROUP BY year
      ORDER BY year`
    )
    .all(...params) as unknown as YearlyActivity[]
}

/**
 * 获取消息长度分布（仅统计文字消息 type=0）
 */
export function getMessageLengthDistribution(db: DatabaseAdapter, filter?: TimeFilter): MessageLengthDistribution {
  const { clause, params } = buildTimeFilter(filter)
  const clauseWithSystem = buildSystemMessageFilter(clause)

  const typeCondition = clauseWithSystem
    ? clauseWithSystem + ' AND msg.type = 0 AND msg.content IS NOT NULL AND LENGTH(msg.content) > 0'
    : 'WHERE msg.type = 0 AND msg.content IS NOT NULL AND LENGTH(msg.content) > 0'

  const rows = db
    .prepare(
      `SELECT LENGTH(msg.content) as len, COUNT(*) as count
       FROM message msg JOIN member m ON msg.sender_id = m.id
       ${typeCondition}
       GROUP BY len ORDER BY len`
    )
    .all(...params) as Array<{ len: number; count: number }>

  const detail: Array<{ len: number; count: number }> = []
  for (let i = 1; i <= 25; i++) {
    const found = rows.find((r) => r.len === i)
    detail.push({ len: i, count: found ? found.count : 0 })
  }

  const ranges = [
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

  const grouped: Array<{ range: string; count: number }> = ranges.map((r) => ({
    range: r.label,
    count: rows.filter((row) => row.len >= r.min && row.len <= r.max).reduce((sum, row) => sum + row.count, 0),
  }))

  return { detail, grouped }
}

/**
 * 获取文字消息统计（仅 type=0）：数量、平均长度、最大长度、短消息（≤5 字）数
 */
export function getTextStats(db: DatabaseAdapter, filter?: TimeFilter): TextStats {
  const { clause, params } = buildTimeFilter(filter)
  const typeCondition =
    buildSystemMessageFilter(clause) + ' AND msg.type = 0 AND msg.content IS NOT NULL AND LENGTH(msg.content) > 0'

  const row = db
    .prepare(
      `SELECT
        COUNT(*) as textCount,
        ROUND(AVG(LENGTH(msg.content)), 1) as avgLength,
        MAX(LENGTH(msg.content)) as maxLength,
        SUM(CASE WHEN LENGTH(msg.content) <= 5 THEN 1 ELSE 0 END) as shortCount
       FROM message msg JOIN member m ON msg.sender_id = m.id
       ${typeCondition}`
    )
    .get(...params) as
    | { textCount: number; avgLength: number | null; maxLength: number | null; shortCount: number | null }
    | undefined

  return {
    textCount: row?.textCount ?? 0,
    avgLength: row?.avgLength ?? 0,
    maxLength: row?.maxLength ?? 0,
    shortCount: row?.shortCount ?? 0,
  }
}

/**
 * 获取长消息（小作文）数量，minLength 为字符阈值（默认 30），仅统计文字消息
 */
export function getLongMessageCount(db: DatabaseAdapter, filter?: TimeFilter, minLength = 30): number {
  const { clause, params } = buildTimeFilter(filter)
  const typeCondition =
    buildSystemMessageFilter(clause) + ' AND msg.type = 0 AND msg.content IS NOT NULL AND LENGTH(msg.content) >= ?'

  const row = db
    .prepare(
      `SELECT COUNT(*) as cnt
       FROM message msg JOIN member m ON msg.sender_id = m.id
       ${typeCondition}`
    )
    .get(...params, minLength) as { cnt: number } | undefined

  return row?.cnt ?? 0
}

/**
 * 获取成员月度消息趋势（按月 × 发送者）
 */
export function getMemberMonthlyTrend(db: DatabaseAdapter, filter?: TimeFilter): MemberMonthlyTrend[] {
  const { clause, params } = buildTimeFilter(filter)
  const clauseWithSystem = buildSystemMessageFilter(clause)

  return db
    .prepare(
      `SELECT
        strftime('%Y-%m', msg.ts, 'unixepoch', 'localtime') as month,
        msg.sender_id as memberId,
        m.account_name as memberName,
        COUNT(*) as count
      FROM message msg JOIN member m ON msg.sender_id = m.id
      ${clauseWithSystem}
      GROUP BY month, msg.sender_id
      ORDER BY month`
    )
    .all(...params) as unknown as MemberMonthlyTrend[]
}

/**
 * 获取文字消息长度百分位（P25/P50/P75/P90），仅统计文字消息
 */
export function getTextLengthPercentiles(db: DatabaseAdapter, filter?: TimeFilter): TextLengthPercentiles {
  const { clause, params } = buildTimeFilter(filter)
  const typeCondition =
    buildSystemMessageFilter(clause) + ' AND msg.type = 0 AND msg.content IS NOT NULL AND LENGTH(msg.content) > 0'

  const rows = db
    .prepare(
      `SELECT LENGTH(msg.content) as len
       FROM message msg JOIN member m ON msg.sender_id = m.id
       ${typeCondition}
       ORDER BY len`
    )
    .all(...params) as Array<{ len: number }>

  if (rows.length === 0) return { p25: 0, p50: 0, p75: 0, p90: 0 }

  const lengths = rows.map((r) => r.len)
  const getPercentile = (arr: number[], p: number) => {
    const idx = Math.ceil((p / 100) * arr.length) - 1
    return arr[Math.max(0, idx)]
  }

  return {
    p25: getPercentile(lengths, 25),
    p50: getPercentile(lengths, 50),
    p75: getPercentile(lengths, 75),
    p90: getPercentile(lengths, 90),
  }
}
