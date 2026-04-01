import { Type } from '@mariozechner/pi-ai'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ToolContext } from '../types'
import { timeParamProperties } from '../utils/schemas'
import * as workerManager from '../../../worker/workerManager'
import { parseExtendedTimeParams } from '../utils/time-params'
import { formatTimeRange, t } from '../utils/format'

const schema = Type.Object({
  member_id_1: Type.Number({ description: 'ai.tools.get_conversation_between.params.member_id_1' }),
  member_id_2: Type.Number({ description: 'ai.tools.get_conversation_between.params.member_id_2' }),
  limit: Type.Optional(Type.Number({ description: 'ai.tools.get_conversation_between.params.limit' })),
  ...timeParamProperties,
})

/** 获取两个群成员之间的对话记录。适用于回答"A和B之间聊了什么"、"查看两人的对话"等问题。需要先通过 get_members 获取成员 ID。支持精确到分钟级别的时间查询。 */
export function createTool(context: ToolContext): AgentTool<typeof schema> {
  return {
    name: 'get_conversation_between',
    label: 'get_conversation_between',
    description: 'ai.tools.get_conversation_between.desc',
    parameters: schema,
    execute: async (_toolCallId, params) => {
      const { sessionId, timeFilter: contextTimeFilter, maxMessagesLimit, locale } = context
      const limit = maxMessagesLimit || params.limit || 100
      const effectiveTimeFilter = parseExtendedTimeParams(params, contextTimeFilter)

      const result = await workerManager.getConversationBetween(
        sessionId,
        params.member_id_1,
        params.member_id_2,
        effectiveTimeFilter,
        limit
      )

      if (result.messages.length === 0) {
        const data = {
          error: t('noConversation', locale) as string,
          member1Id: params.member_id_1,
          member2Id: params.member_id_2,
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(data) }],
          details: data,
        }
      }

      const data = {
        total: result.total,
        returned: result.messages.length,
        member1: result.member1Name,
        member2: result.member2Name,
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
