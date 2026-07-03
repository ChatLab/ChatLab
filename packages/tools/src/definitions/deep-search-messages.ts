/**
 * 深度搜索消息工具
 *
 * LIKE 子串匹配，速度较慢但不会遗漏。与 search-messages 结构相同，底层使用不同搜索策略。
 */

import type { ToolDefinition, ToolExecutionContext, ToolResult, JsonSchema } from '../types'
import { parseExtendedTimeParams } from '../utils/time-params'
import { formatTimeRange } from '../utils/format'
import { timeParamProperties } from '../utils/schemas'
import { resolveMessageLimit } from '../utils/limits'

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

  const result = await context.dataProvider!.deepSearchMessages(keywords, {
    timeFilter: effectiveTimeFilter,
    limit,
    senderId: params.sender_id as number | undefined,
  })

  const contextBefore = context.searchContextBefore ?? 2
  const contextAfter = context.searchContextAfter ?? 2
  let finalMessages = result.messages

  if ((contextBefore > 0 || contextAfter > 0) && result.messages.length > 0) {
    const hitIds = result.messages.map((m) => m.id).filter((id): id is number => id != null)
    if (hitIds.length > 0) {
      finalMessages = await context.dataProvider!.getSearchMessageContext(hitIds, contextBefore, contextAfter)
    }
  }
  finalMessages = finalMessages.slice(0, limit)

  const data = {
    total: result.total,
    returned: finalMessages.length,
    timeRange: formatTimeRange(effectiveTimeFilter, locale),
    rawMessages: finalMessages,
  }

  return { content: JSON.stringify(data), data, rawMessages: finalMessages }
}

export const deepSearchMessagesTool: ToolDefinition = {
  name: 'deep_search_messages',
  description:
    '深度搜索消息（LIKE 子串匹配，速度较慢但不会遗漏），适用于全文搜索精确匹配或 FTS 搜索无结果时的补充搜索。',
  inputSchema,
  handler,
  category: 'core',
  truncationStrategy: 'keep_first',
}
