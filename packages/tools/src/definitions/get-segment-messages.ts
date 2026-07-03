/**
 * 获取段落完整消息工具
 */

import type { ToolDefinition, ToolExecutionContext, ToolResult, JsonSchema } from '../types'
import { isChineseLocale } from '../utils/format'
import { resolveMessageLimit } from '../utils/limits'

const inputSchema: JsonSchema = {
  type: 'object',
  properties: {
    segment_id: { type: 'number', description: '段落 ID（通过 get_segment_summaries 获取）' },
    limit: { type: 'number', description: '返回的最大消息条数' },
  },
  required: ['segment_id'],
}

async function handler(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const { locale, maxMessagesLimit } = context
  const limit = resolveMessageLimit(params.limit, 1000, maxMessagesLimit)

  const result = await context.dataProvider!.getSegmentMessages(params.segment_id as number, limit)

  if (!result) {
    const data = {
      error: isChineseLocale(locale) ? '未找到指定的段落' : 'Segment not found',
      segmentId: params.segment_id,
    }
    return { content: JSON.stringify(data), data }
  }

  const localeStr = isChineseLocale(locale) ? 'zh-CN' : 'en-US'
  const startTime = new Date(result.startTs * 1000).toLocaleString(localeStr)
  const endTime = new Date(result.endTs * 1000).toLocaleString(localeStr)
  const rawMessages = result.messages.map((m) => ({
    id: m.id,
    senderName: m.senderName,
    content: m.content,
    timestamp: m.timestamp,
  }))

  const data = {
    segmentId: result.segmentId,
    time: `${startTime} ~ ${endTime}`,
    messageCount: result.messageCount,
    returnedCount: result.returnedCount,
    participants: result.participants,
    rawMessages,
  }

  return { content: JSON.stringify(data), data, rawMessages }
}

export const getSegmentMessagesTool: ToolDefinition = {
  name: 'get_segment_messages',
  description:
    '获取指定段落的完整消息列表。用于在 get_segment_summaries 找到相关段落摘要后，获取该段落的完整原文上下文。',
  inputSchema,
  handler,
  category: 'core',
  truncationStrategy: 'keep_last',
}
