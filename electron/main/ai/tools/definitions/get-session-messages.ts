import { Type } from '@mariozechner/pi-ai'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ToolContext } from '../types'
import * as workerManager from '../../../worker/workerManager'
import { isChineseLocale } from '../utils/format'

const schema = Type.Object({
  session_id: Type.Number({ description: 'ai.tools.get_session_messages.params.session_id' }),
  limit: Type.Optional(Type.Number({ description: 'ai.tools.get_session_messages.params.limit' })),
})

/** 获取指定会话的完整消息列表。用于在 search_sessions 找到相关会话后，获取该会话的完整上下文。返回会话的所有消息及参与者信息。 */
export function createTool(context: ToolContext): AgentTool<typeof schema> {
  return {
    name: 'get_session_messages',
    label: 'get_session_messages',
    description: 'ai.tools.get_session_messages.desc',
    parameters: schema,
    execute: async (_toolCallId, params) => {
      const { sessionId, maxMessagesLimit, locale } = context
      const limit = maxMessagesLimit || params.limit || 1000

      const result = await workerManager.getSessionMessages(sessionId, params.session_id, limit)

      let data: Record<string, unknown>
      if (!result) {
        data = {
          error: isChineseLocale(locale) ? '未找到指定的会话' : 'Session not found',
          sessionId: params.session_id,
        }
      } else {
        const localeStr = isChineseLocale(locale) ? 'zh-CN' : 'en-US'
        const startTime = new Date(result.startTs * 1000).toLocaleString(localeStr)
        const endTime = new Date(result.endTs * 1000).toLocaleString(localeStr)
        data = {
          sessionId: result.sessionId,
          time: `${startTime} ~ ${endTime}`,
          messageCount: result.messageCount,
          returnedCount: result.returnedCount,
          participants: result.participants,
          rawMessages: result.messages,
        }
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(data) }],
        details: data,
      }
    },
  }
}
