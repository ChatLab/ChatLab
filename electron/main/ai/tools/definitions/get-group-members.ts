import { Type } from '@mariozechner/pi-ai'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ToolContext } from '../types'
import * as workerManager from '../../../worker/workerManager'
import { isChineseLocale, t } from '../utils/format'

const schema = Type.Object({
  search: Type.Optional(Type.String({ description: 'ai.tools.get_members.params.search' })),
  limit: Type.Optional(Type.Number({ description: 'ai.tools.get_members.params.limit' })),
})

/** 获取成员列表，包括成员的基本信息、别名和消息统计。适用于查询"有哪些人"、"某人的别名是什么"、"谁的QQ号是xxx"等问题。 */
export function createTool(context: ToolContext): AgentTool<typeof schema> {
  return {
    name: 'get_members',
    label: 'get_members',
    description: 'ai.tools.get_members.desc',
    parameters: schema,
    execute: async (_toolCallId, params) => {
      const { sessionId, locale } = context
      const members = await workerManager.getMembers(sessionId)

      let filteredMembers = members
      if (params.search) {
        const keyword = params.search.toLowerCase()
        filteredMembers = members.filter((m) => {
          if (m.groupNickname && m.groupNickname.toLowerCase().includes(keyword)) return true
          if (m.accountName && m.accountName.toLowerCase().includes(keyword)) return true
          if (m.platformId.includes(keyword)) return true
          if (m.aliases.some((alias) => alias.toLowerCase().includes(keyword))) return true
          return false
        })
      }

      if (params.limit && params.limit > 0) {
        filteredMembers = filteredMembers.slice(0, params.limit)
      }

      const msgSuffix = isChineseLocale(locale) ? '条' : ''
      const aliasLabel = t('alias', locale) as string
      const data = {
        totalMembers: members.length,
        returnedMembers: filteredMembers.length,
        members: filteredMembers.map((m) => {
          const displayName = m.groupNickname || m.accountName || m.platformId
          const aliasStr = m.aliases.length > 0 ? `|${aliasLabel}:${m.aliases.join(',')}` : ''
          return `${m.id}|${m.platformId}|${displayName}|${m.messageCount}${msgSuffix}${aliasStr}`
        }),
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(data) }],
        details: data,
      }
    },
  }
}
