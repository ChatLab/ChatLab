import { Type } from '@mariozechner/pi-ai'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ToolContext } from '../types'
import * as workerManager from '../../../worker/workerManager'
import { isChineseLocale } from '../utils/format'

const schema = Type.Object({
  top_n: Type.Optional(Type.Number({ description: 'ai.tools.get_member_stats.params.top_n' })),
})

/** 获取群成员的活跃度统计数据。适用于回答"谁最活跃"、"发言最多的是谁"等问题。 */
export function createTool(context: ToolContext): AgentTool<typeof schema> {
  return {
    name: 'get_member_stats',
    label: 'get_member_stats',
    description: 'ai.tools.get_member_stats.desc',
    parameters: schema,
    execute: async (_toolCallId, params) => {
      const { sessionId, timeFilter, locale } = context
      const topN = params.top_n || 10

      const result = await workerManager.getMemberActivity(sessionId, timeFilter)
      const topMembers = result.slice(0, topN)

      const msgSuffix = isChineseLocale(locale) ? '条' : ''
      const data = {
        totalMembers: result.length,
        topMembers: topMembers.map(
          (m, index) => `${index + 1}. ${m.name} ${m.messageCount}${msgSuffix}(${m.percentage}%)`
        ),
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(data) }],
        details: data,
      }
    },
  }
}
