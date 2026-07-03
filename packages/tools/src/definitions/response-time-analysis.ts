/**
 * 响应时间分析工具
 *
 * 基于参数化 SQL + JS 聚合的启发式回复延迟统计。
 */

import { computeResponseTimeStats } from '@openchatlab/core'
import type { ToolDefinition, ToolExecutionContext, ToolResult, JsonSchema } from '../types'
import { isChineseLocale } from '../utils/format'

interface MsgRow {
  sender_id: number
  name: string
  ts: number
}

const inputSchema: JsonSchema = {
  type: 'object',
  properties: {
    days: { type: 'number', description: '分析最近多少天的数据，默认 30' },
    top_n: { type: 'number', description: '返回前多少名，默认 10' },
  },
}

async function handler(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const { locale } = context
  const isZh = isChineseLocale(locale)
  const days = (params.days as number) || 30
  const topN = (params.top_n as number) || 10

  const sql = `
    SELECT msg.sender_id, COALESCE(m.group_nickname, m.account_name) AS name, msg.ts
    FROM message msg
    JOIN member m ON msg.sender_id = m.id
    WHERE msg.type = 0
      AND msg.ts > unixepoch('now', '-' || @days || ' days')
    ORDER BY msg.ts ASC
  `
  const rows = await context.dataProvider!.executeParameterizedSql<MsgRow>(sql, { days })
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

  const data = {
    period: isZh ? `近${days}天` : `Last ${days} days`,
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
