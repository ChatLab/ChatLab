/**
 * 响应时间分析工具
 *
 * 基于参数化 SQL + JS 聚合的启发式回复延迟统计。
 */

import { computeResponseTimeStats } from '@openchatlab/core'
import type { ToolDefinition, ToolExecutionContext, ToolResult, JsonSchema } from '../types'
import { formatTimeRange, isChineseLocale } from '../utils/format'
import { parseExtendedTimeParams, type ExtendedTimeParams } from '../utils/time-params'
import { timeParamProperties } from '../utils/schemas'

interface MsgRow {
  sender_id: number
  name: string
  ts: number
}

const inputSchema: JsonSchema = {
  type: 'object',
  properties: {
    days: {
      type: 'number',
      description: 'Recent days to analyze when no explicit or selected time range is available; defaults to 30',
    },
    top_n: { type: 'number', description: '返回前多少名，默认 10' },
    ...timeParamProperties,
  },
}

async function handler(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const { locale } = context
  const isZh = isChineseLocale(locale)
  const days = (params.days as number) || 30
  const topN = (params.top_n as number) || 10

  const effectiveTimeFilter = parseExtendedTimeParams(params as ExtendedTimeParams, context.timeFilter)
  const timeCondition = effectiveTimeFilter
    ? 'msg.ts >= @startTs AND msg.ts <= @endTs'
    : "msg.ts > unixepoch('now', '-' || @days || ' days')"
  const sql = `
    SELECT msg.sender_id, COALESCE(m.group_nickname, m.account_name) AS name, msg.ts
    FROM message msg
    JOIN member m ON msg.sender_id = m.id
    WHERE msg.type = 0
      AND ${timeCondition}
    ORDER BY msg.ts ASC
  `
  const rows = await context.dataProvider!.executeParameterizedSql<MsgRow>(
    sql,
    effectiveTimeFilter ? { ...effectiveTimeFilter } : { days }
  )
  if (!rows || rows.length < 2) {
    const text = isZh
      ? '该时间范围内消息不足，无法分析响应时间'
      : 'Not enough messages in this time range to analyze response time'
    return { content: text, data: null }
  }

  const stats = computeResponseTimeStats(
    rows.map((r) => ({ senderId: r.sender_id, name: r.name, ts: r.ts })),
    topN
  )

  if (stats.length === 0) {
    const text = isZh ? '没有足够的响应数据进行分析' : 'Not enough response data for analysis'
    return { content: text, data: null }
  }

  const formatTime = (s: number) => {
    if (s < 60) return isZh ? `${s}秒` : `${s}s`
    const m = Math.floor(s / 60)
    const sec = s % 60
    return isZh ? `${m}分${sec}秒` : `${m}m${sec}s`
  }

  const ranking = stats.map((s, i) => ({
    rank: i + 1,
    name: s.name,
    median: formatTime(s.medianSeconds),
    avg: formatTime(s.avgSeconds),
    count: s.responseCount,
  }))

  const formattedRange = formatTimeRange(effectiveTimeFilter, locale)
  const period =
    typeof formattedRange === 'string'
      ? isZh
        ? `近${days}天`
        : `Last ${days} days`
      : `${formattedRange.start} – ${formattedRange.end}`
  const data = {
    period,
    totalResponders: stats.length,
    ranking: ranking.map(
      (r) =>
        `${r.rank}. ${r.name} — ${isZh ? '中位数' : 'median'} ${r.median}, ${isZh ? '平均' : 'avg'} ${r.avg} (${r.count}${isZh ? '次' : ' responses'})`
    ),
  }

  return { content: JSON.stringify(data), data }
}

export const responseTimeAnalysisTool: ToolDefinition = {
  name: 'response_time_analysis',
  description: '分析群成员的响应速度排行，基于回复间隔的中位数和平均值。',
  inputSchema,
  handler,
  category: 'analysis',
}
