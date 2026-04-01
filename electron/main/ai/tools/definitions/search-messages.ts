import { Type } from '@mariozechner/pi-ai'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ToolContext } from '../types'
import * as workerManager from '../../../worker/workerManager'
import { parseExtendedTimeParams } from '../utils/time-params'
import { formatTimeRange } from '../utils/format'
import { timeParamProperties } from '../utils/schemas'

const schema = Type.Object({
  keywords: Type.Array(Type.String(), { description: 'ai.tools.search_messages.params.keywords' }),
  sender_id: Type.Optional(Type.Number({ description: 'ai.tools.search_messages.params.sender_id' })),
  limit: Type.Optional(Type.Number({ description: 'ai.tools.search_messages.params.limit' })),
  ...timeParamProperties,
})

/** 根据关键词搜索群聊记录。适用于用户想要查找特定话题、关键词相关的聊天内容。可以指定时间范围和发送者来筛选消息。支持精确到分钟级别的时间查询。 */
export function createTool(context: ToolContext): AgentTool<typeof schema> {
  return {
    name: 'search_messages',
    label: 'search_messages',
    description: 'ai.tools.search_messages.desc',
    parameters: schema,
    execute: async (_toolCallId, params) => {
      const { sessionId, timeFilter: contextTimeFilter, maxMessagesLimit, locale } = context
      const limit = Math.min(maxMessagesLimit || params.limit || 1000, 50000)
      const effectiveTimeFilter = parseExtendedTimeParams(params, contextTimeFilter)

      const result = await workerManager.searchMessages(
        sessionId,
        params.keywords,
        effectiveTimeFilter,
        limit,
        0,
        params.sender_id
      )

      const data = {
        total: result.total,
        returned: result.messages.length,
        timeRange: formatTimeRange(effectiveTimeFilter, locale),
        rawMessages: result.messages,
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(data) }],
        details: data,
      }
    },
  }
}
