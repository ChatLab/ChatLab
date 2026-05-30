/**
 * chart-message SQL 查询
 * 直接通过 window.chatApi.pluginQuery 执行（参数化 + readonly + Worker 线程）
 */

import type {
  HourlyActivity,
  DailyActivity,
  WeekdayActivity,
  MonthlyActivity,
  YearlyActivity,
  MessageTypeCount,
  LengthDistribution,
  TextStats,
} from './types'
import type { TimeFilter } from '@openchatlab/shared-types'

/**
 * 构建时间和成员过滤条件
 */
function buildFilter(filter?: TimeFilter): { conditions: string; params: any[] } {
  const parts: string[] = []
  const params: any[] = []

  if (filter?.startTs != null) {
    parts.push('AND msg.ts >= ?')
    params.push(filter.startTs)
  }
  if (filter?.endTs != null) {
    parts.push('AND msg.ts <= ?')
    params.push(filter.endTs)
  }
  if (filter?.memberId != null) {
    parts.push('AND msg.sender_id = ?')
    params.push(filter.memberId)
  }

  return { conditions: parts.join(' '), params }
}

/** 系统消息过滤条件（始终排除） */
const SYSTEM_FILTER = "AND COALESCE(m.account_name, '') != '系统消息'"

/** 获取消息类型分布 */
export async function queryMessageTypes(sessionId: string, timeFilter?: TimeFilter): Promise<MessageTypeCount[]> {
  const { conditions, params } = buildFilter(timeFilter)

  return window.chatApi.pluginQuery<MessageTypeCount>(
    sessionId,
    `SELECT msg.type, COUNT(*) as count
     FROM message msg
     JOIN member m ON msg.sender_id = m.id
     WHERE 1=1 ${SYSTEM_FILTER} ${conditions}
     GROUP BY msg.type
     ORDER BY count DESC`,
    params
  )
}

/** 获取每小时活跃度分布 */
export async function queryHourlyActivity(sessionId: string, timeFilter?: TimeFilter): Promise<HourlyActivity[]> {
  const { conditions, params } = buildFilter(timeFilter)

  return window.chatApi.pluginQuery<HourlyActivity>(
    sessionId,
    `SELECT
       CAST(strftime('%H', msg.ts, 'unixepoch', 'localtime') AS INTEGER) as hour,
       COUNT(*) as messageCount
     FROM message msg
     JOIN member m ON msg.sender_id = m.id
     WHERE 1=1 ${SYSTEM_FILTER} ${conditions}
     GROUP BY hour
     ORDER BY hour`,
    params
  )
}

/** 获取每日活跃度趋势 */
export async function queryDailyActivity(sessionId: string, timeFilter?: TimeFilter): Promise<DailyActivity[]> {
  const { conditions, params } = buildFilter(timeFilter)

  return window.chatApi.pluginQuery<DailyActivity>(
    sessionId,
    `SELECT
       strftime('%Y-%m-%d', msg.ts, 'unixepoch', 'localtime') as date,
       COUNT(*) as messageCount
     FROM message msg
     JOIN member m ON msg.sender_id = m.id
     WHERE 1=1 ${SYSTEM_FILTER} ${conditions}
     GROUP BY date
     ORDER BY date`,
    params
  )
}

/** 获取星期活跃度分布 */
export async function queryWeekdayActivity(sessionId: string, timeFilter?: TimeFilter): Promise<WeekdayActivity[]> {
  const { conditions, params } = buildFilter(timeFilter)

  return window.chatApi.pluginQuery<WeekdayActivity>(
    sessionId,
    `SELECT
       CASE
         WHEN CAST(strftime('%w', msg.ts, 'unixepoch', 'localtime') AS INTEGER) = 0 THEN 7
         ELSE CAST(strftime('%w', msg.ts, 'unixepoch', 'localtime') AS INTEGER)
       END as weekday,
       COUNT(*) as messageCount
     FROM message msg
     JOIN member m ON msg.sender_id = m.id
     WHERE 1=1 ${SYSTEM_FILTER} ${conditions}
     GROUP BY weekday
     ORDER BY weekday`,
    params
  )
}

/** 获取月份活跃度分布 */
export async function queryMonthlyActivity(sessionId: string, timeFilter?: TimeFilter): Promise<MonthlyActivity[]> {
  const { conditions, params } = buildFilter(timeFilter)

  return window.chatApi.pluginQuery<MonthlyActivity>(
    sessionId,
    `SELECT
       CAST(strftime('%m', msg.ts, 'unixepoch', 'localtime') AS INTEGER) as month,
       COUNT(*) as messageCount
     FROM message msg
     JOIN member m ON msg.sender_id = m.id
     WHERE 1=1 ${SYSTEM_FILTER} ${conditions}
     GROUP BY month
     ORDER BY month`,
    params
  )
}

/** 获取年份活跃度分布 */
export async function queryYearlyActivity(sessionId: string, timeFilter?: TimeFilter): Promise<YearlyActivity[]> {
  const { conditions, params } = buildFilter(timeFilter)

  return window.chatApi.pluginQuery<YearlyActivity>(
    sessionId,
    `SELECT
       CAST(strftime('%Y', msg.ts, 'unixepoch', 'localtime') AS INTEGER) as year,
       COUNT(*) as messageCount
     FROM message msg
     JOIN member m ON msg.sender_id = m.id
     WHERE 1=1 ${SYSTEM_FILTER} ${conditions}
     GROUP BY year
     ORDER BY year`,
    params
  )
}

/** 获取文字消息统计（数量、平均长度、最大长度） */
export async function queryTextStats(sessionId: string, timeFilter?: TimeFilter): Promise<TextStats> {
  const { conditions, params } = buildFilter(timeFilter)

  const rows = await window.chatApi.pluginQuery<TextStats>(
    sessionId,
    `SELECT
       COUNT(*) as textCount,
       ROUND(AVG(LENGTH(msg.content)), 1) as avgLength,
       MAX(LENGTH(msg.content)) as maxLength,
       SUM(CASE WHEN LENGTH(msg.content) <= 5 THEN 1 ELSE 0 END) as shortCount
     FROM message msg
     JOIN member m ON msg.sender_id = m.id
     WHERE 1=1 ${SYSTEM_FILTER} ${conditions}
       AND msg.type = 0 AND msg.content IS NOT NULL AND LENGTH(msg.content) > 0`,
    params
  )

  return rows[0] ?? { textCount: 0, avgLength: 0, maxLength: 0, shortCount: 0 }
}

/** 获取长消息（小作文）数量，minLength 为字符阈值 */
export async function queryLongMessageCount(
  sessionId: string,
  timeFilter?: TimeFilter,
  minLength = 30
): Promise<number> {
  const { conditions, params } = buildFilter(timeFilter)

  const rows = await window.chatApi.pluginQuery<{ cnt: number }>(
    sessionId,
    `SELECT COUNT(*) as cnt
     FROM message msg
     JOIN member m ON msg.sender_id = m.id
     WHERE 1=1 ${SYSTEM_FILTER} ${conditions}
       AND msg.type = 0 AND msg.content IS NOT NULL AND LENGTH(msg.content) >= ?`,
    [...params, minLength]
  )

  return rows[0]?.cnt ?? 0
}

/** 获取消息类型月度趋势（按月 × 类型） */
export async function queryTypeMonthlyTrend(
  sessionId: string,
  timeFilter?: TimeFilter
): Promise<Array<{ month: string; type: number; count: number }>> {
  const { conditions, params } = buildFilter(timeFilter)

  return window.chatApi.pluginQuery<{ month: string; type: number; count: number }>(
    sessionId,
    `SELECT
       strftime('%Y-%m', msg.ts, 'unixepoch', 'localtime') as month,
       msg.type,
       COUNT(*) as count
     FROM message msg
     JOIN member m ON msg.sender_id = m.id
     WHERE 1=1 ${SYSTEM_FILTER} ${conditions}
     GROUP BY month, msg.type
     ORDER BY month, msg.type`,
    params
  )
}

/** 获取成员月度消息趋势（按月 × 发送者） */
export async function queryMemberMonthlyTrend(
  sessionId: string,
  timeFilter?: TimeFilter
): Promise<Array<{ month: string; memberId: number; memberName: string; count: number }>> {
  const { conditions, params } = buildFilter(timeFilter)

  return window.chatApi.pluginQuery<{ month: string; memberId: number; memberName: string; count: number }>(
    sessionId,
    `SELECT
       strftime('%Y-%m', msg.ts, 'unixepoch', 'localtime') as month,
       msg.sender_id as memberId,
       m.account_name as memberName,
       COUNT(*) as count
     FROM message msg
     JOIN member m ON msg.sender_id = m.id
     WHERE 1=1 ${SYSTEM_FILTER} ${conditions}
     GROUP BY month, msg.sender_id
     ORDER BY month`,
    params
  )
}

/** 获取文字消息长度百分位统计 */
export async function queryTextLengthPercentiles(
  sessionId: string,
  timeFilter?: TimeFilter
): Promise<{ p25: number; p50: number; p75: number; p90: number }> {
  const { conditions, params } = buildFilter(timeFilter)

  const rows = await window.chatApi.pluginQuery<{ len: number }>(
    sessionId,
    `SELECT LENGTH(msg.content) as len
     FROM message msg
     JOIN member m ON msg.sender_id = m.id
     WHERE 1=1 ${SYSTEM_FILTER} ${conditions}
       AND msg.type = 0 AND msg.content IS NOT NULL AND LENGTH(msg.content) > 0
     ORDER BY len`,
    params
  )

  if (rows.length === 0) return { p25: 0, p50: 0, p75: 0, p90: 0 }

  const getPercentile = (arr: number[], p: number) => {
    const idx = Math.ceil((p / 100) * arr.length) - 1
    return arr[Math.max(0, idx)]
  }

  const lengths = rows.map((r) => r.len)
  return {
    p25: getPercentile(lengths, 25),
    p50: getPercentile(lengths, 50),
    p75: getPercentile(lengths, 75),
    p90: getPercentile(lengths, 90),
  }
}

/** 获取消息长度分布（仅文字消息） */
export async function queryLengthDistribution(sessionId: string, timeFilter?: TimeFilter): Promise<LengthDistribution> {
  const { conditions, params } = buildFilter(timeFilter)

  const rows = await window.chatApi.pluginQuery<{ len: number; count: number }>(
    sessionId,
    `SELECT LENGTH(msg.content) as len, COUNT(*) as count
     FROM message msg
     JOIN member m ON msg.sender_id = m.id
     WHERE 1=1 ${SYSTEM_FILTER} ${conditions}
       AND msg.type = 0 AND msg.content IS NOT NULL AND LENGTH(msg.content) > 0
     GROUP BY len
     ORDER BY len`,
    params
  )

  // 构建 detail：1-25 逐字
  const detail: Array<{ len: number; count: number }> = []
  for (let i = 1; i <= 25; i++) {
    const found = rows.find((r) => r.len === i)
    detail.push({ len: i, count: found ? found.count : 0 })
  }

  // 构建 grouped：分段统计
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
