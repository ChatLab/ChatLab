/**
 * 消息上下文工具
 *
 * 根据消息 ID 获取前后的上下文消息。
 */

import type { ToolDefinition, ToolExecutionContext, ToolResult, JsonSchema } from '../types'
import { t } from '../utils/format'

const inputSchema: JsonSchema = {
  type: 'object',
  properties: {
    message_ids: { type: 'array', items: { type: 'number' }, description: '消息 ID 列表' },
    context_size: { type: 'number', description: '每条消息前后获取的上下文条数，默认 20' },
  },
  required: ['message_ids'],
}

async function handler(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const { locale } = context
  const maxMessagesLimit = context.maxMessagesLimit
  const requestedMessageIds = params.message_ids as number[]
  const messageIds =
    maxMessagesLimit && maxMessagesLimit > 0 ? requestedMessageIds.slice(0, maxMessagesLimit) : requestedMessageIds
  let contextSize = (params.context_size as number) || 20

  if (maxMessagesLimit && maxMessagesLimit > 0 && messageIds.length > 0) {
    const maxMessagesPerId = Math.max(1, Math.floor(maxMessagesLimit / messageIds.length))
    const maxContextSize = Math.max(0, Math.floor((maxMessagesPerId - 1) / 2))
    contextSize = Math.min(contextSize, maxContextSize)
  }

  const messages = await context.dataProvider!.getMessageContext(messageIds, contextSize)

  if (messages.length === 0) {
    const data = {
      error: t('noMessageContext', locale),
      messageIds,
    }
    return { content: JSON.stringify(data), data }
  }

  const data = {
    totalMessages: messages.length,
    contextSize,
    requestedMessageIds: messageIds,
    rawMessages: messages,
  }

  return { content: JSON.stringify(data), data, rawMessages: messages }
}

export const getMessageContextTool: ToolDefinition = {
  name: 'get_message_context',
  description: '根据消息 ID 获取前后的上下文消息。适用于需要查看某条消息前后聊天内容的场景。',
  inputSchema,
  handler,
  category: 'core',
  truncationStrategy: 'keep_last',
}
