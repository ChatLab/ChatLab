/**
 * 关键词搜索消息工具
 *
 * 支持多关键词、发送者过滤、时间范围、上下文扩展。
 */

import type { ToolDefinition, ToolExecutionContext, ToolResult, JsonSchema } from '../types'
import { parseExtendedTimeParams } from '../utils/time-params'
import { formatTimeRange } from '../utils/format'
import { timeParamProperties } from '../utils/schemas'
import { resolveMessageLimit } from '../utils/limits'
import { trimMessagesPreservingHits } from './search-context'

const inputSchema: JsonSchema = {
  type: 'object',
  properties: {
    keywords: { type: 'array', items: { type: 'string' }, description: '搜索关键词列表' },
    sender_id: { type: 'number', description: '按发送者 ID 过滤（通过 get_members 获取）' },
    limit: { type: 'number', description: '返回的最大消息条数' },
    ...timeParamProperties,
  },
  required: ['keywords'],
}

async function handler(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const { locale, timeFilter: contextTimeFilter, maxMessagesLimit } = context
  const keywords = params.keywords as string[]
  const limit = Math.min(resolveMessageLimit(params.limit, 1000, maxMessagesLimit), 50000)
  const effectiveTimeFilter = parseExtendedTimeParams(params as any, contextTimeFilter)

  const result = await context.dataProvider!.searchMessages(keywords, {
    timeFilter: effectiveTimeFilter,
    limit,
    senderId: params.sender_id as number | undefined,
  })

  const contextBefore = context.searchContextBefore ?? 2
  const contextAfter = context.searchContextAfter ?? 2
  let finalMessages = result.messages
  const hitIds = result.messages.map((m) => m.id).filter((id): id is number => id != null)

  if ((contextBefore > 0 || contextAfter > 0) && result.messages.length > 0) {
    if (hitIds.length > 0) {
      finalMessages = await context.dataProvider!.getSearchMessageContext(hitIds, contextBefore, contextAfter)
    }
  }
  finalMessages = trimMessagesPreservingHits(finalMessages, hitIds, limit)

  const data = {
    total: result.total,
    returned: finalMessages.length,
    timeRange: formatTimeRange(effectiveTimeFilter, locale),
    rawMessages: finalMessages,
  }

  return { content: JSON.stringify(data), data, rawMessages: finalMessages }
}

export const searchMessagesTool: ToolDefinition = {
  name: 'search_messages',
  description:
    '根据关键词搜索群聊记录。适用于用户想要查找特定话题、关键词相关的聊天内容。可以指定时间范围和发送者来筛选消息。',
  inputSchema,
  handler,
  category: 'core',
  truncationStrategy: 'keep_first',
}
