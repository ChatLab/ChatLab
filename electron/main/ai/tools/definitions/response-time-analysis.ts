import { Type } from '@mariozechner/pi-ai'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ToolContext } from '../types'
import * as workerManager from '../../../worker/workerManager'
import { isChineseLocale } from '../utils/format'

interface MsgRow {
  sender_id: number
  name: string
  ts: number
}

const schema = Type.Object({
  days: Type.Optional(Type.Number({ description: 'ai.tools.response_time_analysis.params.days' })),
  top_n: Type.Optional(Type.Number({ description: 'ai.tools.response_time_analysis.params.top_n' })),
})

export function createTool(context: ToolContext): AgentTool<typeof schema> {
  return {
    name: 'response_time_analysis',
    label: 'response_time_analysis',
    description: 'ai.tools.response_time_analysis.desc',
    parameters: schema,
    execute: async (_toolCallId, params) => {
      const { sessionId, locale } = context
      const isZh = isChineseLocale(locale)
      const days = params.days || 30
      const topN = params.top_n || 10

      const sql = `
        SELECT msg.sender_id, COALESCE(m.group_nickname, m.account_name) AS name, msg.ts
        FROM message msg
        JOIN member m ON msg.sender_id = m.id
        WHERE msg.type = 0
          AND msg.ts > unixepoch('now', '-' || @days || ' days')
        ORDER BY msg.ts ASC
      `
      const rows = await workerManager.pluginQuery<MsgRow>(sessionId, sql, { days })
      if (!rows || rows.length < 2) {
        const text = isZh ? '该时间范围内消息不足，无法分析响应时间' : 'Not enough messages in this time range to analyze response time'
        return { content: [{ type: 'text', text }], details: null }
      }

      const responseTimes = new Map<number, { name: string; times: number[] }>()

      for (let i = 1; i < rows.length; i++) {
        const prev = rows[i - 1]
        const curr = rows[i]
        if (curr.sender_id === prev.sender_id) continue

        const gap = curr.ts - prev.ts
        // 5 秒 ~ 30 分钟的间隔视为有效响应
        if (gap < 5 || gap > 1800) continue

        if (!responseTimes.has(curr.sender_id)) {
          responseTimes.set(curr.sender_id, { name: curr.name, times: [] })
        }
        responseTimes.get(curr.sender_id)!.times.push(gap)
      }

      const stats = [...responseTimes.entries()]
        .map(([id, { name, times }]) => {
          times.sort((a, b) => a - b)
          const avg = Math.round(times.reduce((s, t) => s + t, 0) / times.length)
          const median = times[Math.floor(times.length / 2)]
          return { id, name, avgSeconds: avg, medianSeconds: median, responseCount: times.length }
        })
        .filter((s) => s.responseCount >= 3)
        .sort((a, b) => a.medianSeconds - b.medianSeconds)
        .slice(0, topN)

      if (stats.length === 0) {
        const text = isZh ? '没有足够的响应数据进行分析' : 'Not enough response data for analysis'
        return { content: [{ type: 'text', text }], details: null }
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

      return {
        content: [{ type: 'text', text: JSON.stringify(data) }],
        details: data,
      }
    },
  }
}
