import { Type } from '@mariozechner/pi-ai'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ToolContext } from '../types'
import * as workerManager from '../../../worker/workerManager'
import { isChineseLocale, i18nTexts, t } from '../utils/format'

const schema = Type.Object({
  type: Type.Union([Type.Literal('hourly'), Type.Literal('weekday'), Type.Literal('daily')], {
    description: 'ai.tools.get_time_stats.params.type',
  }),
})

/** 获取群聊的时间分布统计。适用于回答"什么时候最活跃"、"大家一般几点聊天"等问题。 */
export function createTool(context: ToolContext): AgentTool<typeof schema> {
  return {
    name: 'get_time_stats',
    label: 'get_time_stats',
    description: 'ai.tools.get_time_stats.desc',
    parameters: schema,
    execute: async (_toolCallId, params) => {
      const { sessionId, timeFilter, locale } = context
      const msgSuffix = isChineseLocale(locale) ? '条' : ''

      let data: Record<string, unknown>
      switch (params.type) {
        case 'hourly': {
          const result = await workerManager.getHourlyActivity(sessionId, timeFilter)
          const peak = result.reduce((max, curr) => (curr.messageCount > max.messageCount ? curr : max))
          data = {
            peakHour: `${peak.hour}:00 (${peak.messageCount}${msgSuffix})`,
            distribution: result.map((h) => `${h.hour}:00 ${h.messageCount}${msgSuffix}`),
          }
          break
        }
        case 'weekday': {
          const weekdayNames = t('weekdays', locale) as string[]
          const result = await workerManager.getWeekdayActivity(sessionId, timeFilter)
          const peak = result.reduce((max, curr) => (curr.messageCount > max.messageCount ? curr : max))
          data = {
            peakDay: `${weekdayNames[peak.weekday]} (${peak.messageCount}${msgSuffix})`,
            distribution: result.map((w) => `${weekdayNames[w.weekday]} ${w.messageCount}${msgSuffix}`),
          }
          break
        }
        case 'daily': {
          const result = await workerManager.getDailyActivity(sessionId, timeFilter)
          const recent = result.slice(-30)
          const total = recent.reduce((sum, d) => sum + d.messageCount, 0)
          const avg = Math.round(total / recent.length)
          const summaryFn = i18nTexts.dailySummary[isChineseLocale(locale) ? 'zh' : 'en']
          data = {
            summary: summaryFn(recent.length, total, avg),
            trend: recent.map((d) => `${d.date} ${d.messageCount}${msgSuffix}`),
          }
          break
        }
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(data) }],
        details: data,
      }
    },
  }
}
