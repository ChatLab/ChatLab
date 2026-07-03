/**
 * 两人对话查询工具
 */

import type { ToolDefinition, ToolExecutionContext, ToolResult, JsonSchema } from '../types'
import { parseExtendedTimeParams } from '../utils/time-params'
import { formatTimeRange, t } from '../utils/format'
import { timeParamProperties } from '../utils/schemas'
import { resolveMessageLimit } from '../utils/limits'

const inputSchema: JsonSchema = {
  type: 'object',
  properties: {
    member_id_1: { type: 'number', description: '第一个成员的 ID（通过 get_members 获取）' },
    member_id_2: { type: 'number', description: '第二个成员的 ID（通过 get_members 获取）' },
    limit: { type: 'number', description: '返回的最大消息条数' },
    ...timeParamProperties,
  },
  required: ['member_id_1', 'member_id_2'],
}

async function handler(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const { locale, timeFilter: contextTimeFilter, maxMessagesLimit } = context
  const limit = resolveMessageLimit(params.limit, 100, maxMessagesLimit)
  const effectiveTimeFilter = parseExtendedTimeParams(params as any, contextTimeFilter)

  const result = await context.dataProvider!.getConversationBetween(
    params.member_id_1 as number,
    params.member_id_2 as number,
    effectiveTimeFilter,
    limit
  )

  if (result.messages.length === 0) {
    const data = {
      error: t('noConversation', locale),
      member1Id: params.member_id_1,
      member2Id: params.member_id_2,
    }
    return { content: JSON.stringify(data), data }
  }

  const data = {
    total: result.total,
    returned: result.messages.length,
    member1: result.member1Name,
    member2: result.member2Name,
    timeRange: formatTimeRange(effectiveTimeFilter, locale),
    rawMessages: result.messages,
  }

  return { content: JSON.stringify(data), data, rawMessages: result.messages }
}

export const getConversationBetweenTool: ToolDefinition = {
  name: 'get_conversation_between',
  description: '获取两个群成员之间的对话记录。适用于回答"A和B之间聊了什么"等问题。需要先通过 get_members 获取成员 ID。',
  inputSchema,
  handler,
  category: 'analysis',
  truncationStrategy: 'keep_last',
}
