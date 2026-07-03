/**
 * 最近消息工具
 *
 * 获取指定时间段内的群聊消息，支持 start_time/end_time 参数。
 */

import type { ToolDefinition, ToolExecutionContext, ToolResult, JsonSchema } from '../types'
import { parseExtendedTimeParams } from '../utils/time-params'
import { formatTimeRange } from '../utils/format'
import { timeParamProperties } from '../utils/schemas'
import { resolveMessageLimit } from '../utils/limits'

const inputSchema: JsonSchema = {
  type: 'object',
  properties: {
    limit: {
      type: 'number',
      description: '返回的消息条数',
      default: 100,
    },
    ...timeParamProperties,
  },
}

async function handler(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const { locale, timeFilter: contextTimeFilter, maxMessagesLimit } = context
  const limit = resolveMessageLimit(params.limit, 100, maxMessagesLimit)
  const effectiveTimeFilter = parseExtendedTimeParams(params as any, contextTimeFilter)

  const result = await context.dataProvider!.getRecentMessages({ timeFilter: effectiveTimeFilter, limit })

  const data = {
    total: result.total,
    returned: result.messages.length,
    timeRange: formatTimeRange(effectiveTimeFilter, locale),
    rawMessages: result.messages,
  }

  return {
    content: JSON.stringify(data),
    data,
    rawMessages: result.messages,
  }
}

export const recentMessagesTool: ToolDefinition = {
  name: 'get_recent_messages',
  description: '获取指定时间段内的群聊消息。适用于回答"最近大家聊了什么"等概览性问题。支持精确到分钟级别的时间查询。',
  inputSchema,
  handler,
  category: 'core',
  truncationStrategy: 'keep_last',
}
