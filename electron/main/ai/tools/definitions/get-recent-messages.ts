import { Type } from '@mariozechner/pi-ai'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ToolContext } from '../types'
import * as workerManager from '../../../worker/workerManager'
import { parseExtendedTimeParams } from '../utils/time-params'
import { formatTimeRange } from '../utils/format'
import { timeParamProperties } from '../utils/schemas'

const schema = Type.Object({
  limit: Type.Optional(Type.Number({ description: 'ai.tools.get_recent_messages.params.limit' })),
  ...timeParamProperties,
})

/** 获取指定时间段内的群聊消息。适用于回答"最近大家聊了什么"、"X月群里聊了什么"等概览性问题。支持精确到分钟级别的时间查询。 */
export function createTool(context: ToolContext): AgentTool<typeof schema> {
  return {
    name: 'get_recent_messages',
    label: 'get_recent_messages',
    description: 'ai.tools.get_recent_messages.desc',
    parameters: schema,
    execute: async (_toolCallId, params) => {
      const { sessionId, timeFilter: contextTimeFilter, maxMessagesLimit, locale } = context
      const limit = maxMessagesLimit || params.limit || 100
      const effectiveTimeFilter = parseExtendedTimeParams(params, contextTimeFilter)

      const result = await workerManager.getRecentMessages(sessionId, effectiveTimeFilter, limit)

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
