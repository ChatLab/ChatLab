import { Type } from '@mariozechner/pi-ai'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ToolContext } from '../types'
import * as workerManager from '../../../worker/workerManager'
import { parseExtendedTimeParams } from '../utils/time-params'
import { formatTimeRange } from '../utils/format'
import { timeParamProperties } from '../utils/schemas'

const schema = Type.Object({
  keywords: Type.Array(Type.String(), { description: 'ai.tools.deep_search_messages.params.keywords' }),
  sender_id: Type.Optional(Type.Number({ description: 'ai.tools.deep_search_messages.params.sender_id' })),
  limit: Type.Optional(Type.Number({ description: 'ai.tools.deep_search_messages.params.limit' })),
  ...timeParamProperties,
})

export function createTool(context: ToolContext): AgentTool<typeof schema> {
  return {
    name: 'deep_search_messages',
    label: 'deep_search_messages',
    description: 'ai.tools.deep_search_messages.desc',
    parameters: schema,
    execute: async (_toolCallId, params) => {
      const { sessionId, timeFilter: contextTimeFilter, maxMessagesLimit, locale } = context
      const limit = Math.min(maxMessagesLimit || params.limit || 1000, 50000)
      const effectiveTimeFilter = parseExtendedTimeParams(params, contextTimeFilter)

      const result = await workerManager.deepSearchMessages(
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
