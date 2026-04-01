import { Type } from '@mariozechner/pi-ai'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ToolContext } from '../types'
import * as workerManager from '../../../worker/workerManager'
import { t } from '../utils/format'

const schema = Type.Object({
  message_ids: Type.Array(Type.Number(), { description: 'ai.tools.get_message_context.params.message_ids' }),
  context_size: Type.Optional(Type.Number({ description: 'ai.tools.get_message_context.params.context_size' })),
})

/** 根据消息 ID 获取前后的上下文消息。适用于需要查看某条消息前后聊天内容的场景，比如"这条消息的前后在聊什么"、"查看某条消息的上下文"等。支持单个或批量消息 ID。 */
export function createTool(context: ToolContext): AgentTool<typeof schema> {
  return {
    name: 'get_message_context',
    label: 'get_message_context',
    description: 'ai.tools.get_message_context.desc',
    parameters: schema,
    execute: async (_toolCallId, params) => {
      const { sessionId, locale } = context
      const contextSize = params.context_size || 20

      const messages = await workerManager.getMessageContext(sessionId, params.message_ids, contextSize)

      if (messages.length === 0) {
        const data = {
          error: t('noMessageContext', locale) as string,
          messageIds: params.message_ids,
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(data) }],
          details: data,
        }
      }

      const data = {
        totalMessages: messages.length,
        contextSize: contextSize,
        requestedMessageIds: params.message_ids,
        rawMessages: messages,
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(data) }],
        details: data,
      }
    },
  }
}
