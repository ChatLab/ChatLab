import { Type } from '@mariozechner/pi-ai'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ToolContext } from '../types'
import * as workerManager from '../../../worker/workerManager'
import { parseExtendedTimeParams } from '../utils/time-params'
import { formatTimeRange, isChineseLocale } from '../utils/format'
import { timeParamPropertiesNoHour } from '../utils/schemas'

const schema = Type.Object({
  keywords: Type.Optional(Type.Array(Type.String(), { description: 'ai.tools.get_session_summaries.params.keywords' })),
  limit: Type.Optional(Type.Number({ description: 'ai.tools.get_session_summaries.params.limit' })),
  ...timeParamPropertiesNoHour,
})

/** 获取会话摘要列表，快速了解群聊历史讨论的主题。适用场景：1. 了解群里最近在聊什么话题 2. 按关键词搜索讨论过的话题 3. 概览性问题如"群里有没有讨论过旅游"。返回的摘要是对每个会话的简短总结，可以帮助快速定位感兴趣的会话，然后用 get_session_messages 获取详情。 */
export function createTool(context: ToolContext): AgentTool<typeof schema> {
  return {
    name: 'get_session_summaries',
    label: 'get_session_summaries',
    description: 'ai.tools.get_session_summaries.desc',
    parameters: schema,
    execute: async (_toolCallId, params) => {
      const { sessionId, timeFilter: contextTimeFilter, locale } = context
      const limit = params.limit || 20
      const effectiveTimeFilter = parseExtendedTimeParams(params, contextTimeFilter)

      const sessions = await workerManager.getSessionSummaries(sessionId, {
        limit: limit * 2,
        timeFilter: effectiveTimeFilter,
      })

      let data: Record<string, unknown>
      if (!sessions || sessions.length === 0) {
        data = {
          message: isChineseLocale(locale)
            ? '未找到带摘要的会话。可能还没有生成摘要，请在会话时间线中点击"批量生成"按钮。'
            : 'No sessions with summaries found. Summaries may not have been generated yet.',
        }
      } else {
        let filteredSessions = sessions
        if (params.keywords && params.keywords.length > 0) {
          const keywords = params.keywords.map((k) => k.toLowerCase())
          filteredSessions = sessions.filter((s) =>
            keywords.some((keyword) => s.summary?.toLowerCase().includes(keyword))
          )
        }

        filteredSessions = filteredSessions.filter((s) => s.summary)
        const limitedSessions = filteredSessions.slice(0, limit)

        const localeStr = isChineseLocale(locale) ? 'zh-CN' : 'en-US'

        data = {
          total: filteredSessions.length,
          returned: limitedSessions.length,
          timeRange: formatTimeRange(effectiveTimeFilter, locale),
          sessions: limitedSessions.map((s) => {
            const startTime = new Date(s.startTs * 1000).toLocaleString(localeStr)
            const endTime = new Date(s.endTs * 1000).toLocaleString(localeStr)
            return {
              sessionId: s.id,
              time: `${startTime} ~ ${endTime}`,
              messageCount: s.messageCount,
              participants: s.participants,
              summary: s.summary,
            }
          }),
        }
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(data) }],
        details: data,
      }
    },
  }
}
