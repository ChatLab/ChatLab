import { Type } from '@mariozechner/pi-ai'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ToolContext } from '../types'
import * as workerManager from '../../../worker/workerManager'
import { isChineseLocale, t } from '../utils/format'

const schema = Type.Object({
  member_id: Type.Number({ description: 'ai.tools.get_member_name_history.params.member_id' }),
})

/** 获取成员的昵称变更历史记录。适用于回答"某人以前叫什么名字"、"某人的昵称变化"、"某人曾用名"等问题。需要先通过 get_members 工具获取成员 ID。 */
export function createTool(context: ToolContext): AgentTool<typeof schema> {
  return {
    name: 'get_member_name_history',
    label: 'get_member_name_history',
    description: 'ai.tools.get_member_name_history.desc',
    parameters: schema,
    execute: async (_toolCallId, params) => {
      const { sessionId, locale } = context

      const members = await workerManager.getMembers(sessionId)
      const member = members.find((m) => m.id === params.member_id)

      if (!member) {
        const data = {
          error: t('memberNotFound', locale) as string,
          member_id: params.member_id,
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(data) }],
          details: data,
        }
      }

      const history = await workerManager.getMemberNameHistory(sessionId, params.member_id)

      const localeStr = isChineseLocale(locale) ? 'zh-CN' : 'en-US'
      const untilNow = t('untilNow', locale) as string
      const formatHistory = (h: { name: string; startTs: number; endTs: number | null }) => {
        const start = new Date(h.startTs * 1000).toLocaleDateString(localeStr)
        const end = h.endTs ? new Date(h.endTs * 1000).toLocaleDateString(localeStr) : untilNow
        return `${h.name} (${start} ~ ${end})`
      }

      const accountNames = history.filter((h: { nameType: string }) => h.nameType === 'account_name').map(formatHistory)
      const groupNicknames = history
        .filter((h: { nameType: string }) => h.nameType === 'group_nickname')
        .map(formatHistory)

      const displayName = member.groupNickname || member.accountName || member.platformId
      const aliasLabel = t('alias', locale) as string
      const aliasStr = member.aliases.length > 0 ? `|${aliasLabel}:${member.aliases.join(',')}` : ''
      const noChangeRecord = t('noChangeRecord', locale) as string

      const data = {
        member: `${member.id}|${member.platformId}|${displayName}${aliasStr}`,
        accountNameHistory: accountNames.length > 0 ? accountNames : noChangeRecord,
        groupNicknameHistory: groupNicknames.length > 0 ? groupNicknames : noChangeRecord,
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(data) }],
        details: data,
      }
    },
  }
}
