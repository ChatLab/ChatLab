/**
 * chart-interaction 数据查询
 *
 * 将原 getMentionGraph 后端函数拆解为：
 * 1. 三个 SQL 查询获取原始数据
 * 2. 一个 compute 在 Worker 中完成关系图构建
 */

import type { MemberInfo, NameHistory, MentionMessage, MentionGraphData, BuildGraphInput } from './types'

interface TimeFilter {
  startTs?: number
  endTs?: number
  memberId?: number | null
}

/**
 * 构建时间和成员过滤条件
 */
function buildFilter(filter?: TimeFilter): { conditions: string; params: any[] } {
  const parts: string[] = []
  const params: any[] = []

  if (filter?.startTs != null) {
    parts.push('AND msg.ts >= ?')
    params.push(filter.startTs)
  }
  if (filter?.endTs != null) {
    parts.push('AND msg.ts <= ?')
    params.push(filter.endTs)
  }
  if (filter?.memberId != null) {
    parts.push('AND msg.sender_id = ?')
    params.push(filter.memberId)
  }

  return { conditions: parts.join(' '), params }
}

const SYSTEM_FILTER = "AND COALESCE(m.account_name, '') != '系统消息'"

/**
 * 查询所有成员信息及消息数量
 */
async function queryMembers(sessionId: string, timeFilter?: TimeFilter): Promise<MemberInfo[]> {
  const { conditions, params } = buildFilter(timeFilter)

  return window.chatApi.pluginQuery<MemberInfo>(
    sessionId,
    `SELECT
       m.id,
       m.platform_id as platformId,
       COALESCE(m.group_nickname, m.account_name, m.platform_id) as name,
       COUNT(msg.id) as messageCount
     FROM member m
     LEFT JOIN message msg ON m.id = msg.sender_id ${conditions} ${SYSTEM_FILTER}
     WHERE COALESCE(m.account_name, '') != '系统消息'
     GROUP BY m.id`,
    params
  )
}

/**
 * 查询所有成员的历史昵称
 */
async function queryNameHistory(sessionId: string): Promise<NameHistory[]> {
  return window.chatApi.pluginQuery<NameHistory>(
    sessionId,
    `SELECT member_id as memberId, name
     FROM member_name_history`
  )
}

/**
 * 查询包含 @ 的消息
 */
async function queryMentionMessages(sessionId: string, timeFilter?: TimeFilter): Promise<MentionMessage[]> {
  const { conditions, params } = buildFilter(timeFilter)

  return window.chatApi.pluginQuery<MentionMessage>(
    sessionId,
    `SELECT msg.sender_id as senderId, msg.content
     FROM message msg
     JOIN member m ON msg.sender_id = m.id
     WHERE COALESCE(m.account_name, '') != '系统消息'
       AND msg.type = 0
       AND msg.content IS NOT NULL
       AND msg.content LIKE '%@%'
       ${conditions}`,
    params
  )
}

/**
 * 在 Worker 线程中构建关系图的纯函数
 *
 * ⚠️ 此函数会被序列化后在 Worker 中执行，
 *    所有逻辑和辅助函数都必须内联，不能引用外部变量。
 */
function buildMentionGraph(input: BuildGraphInput): MentionGraphData {
  const { members, nameHistory, messages } = input
  const emptyResult: MentionGraphData = { nodes: [], links: [], maxLinkValue: 0 }

  if (members.length === 0) return emptyResult

  // 1. 构建昵称到成员ID的映射
  const nameToMemberId = new Map<string, number>()
  const memberIdToInfo = new Map<number, { name: string; messageCount: number }>()

  for (const member of members) {
    memberIdToInfo.set(member.id, { name: member.name, messageCount: member.messageCount })
    nameToMemberId.set(member.name, member.id)
  }

  // 添加历史昵称映射
  for (const h of nameHistory) {
    if (!nameToMemberId.has(h.name)) {
      nameToMemberId.set(h.name, h.memberId)
    }
  }

  // 2. 解析 @ 并构建关系矩阵
  const mentionMatrix = new Map<number, Map<number, number>>()
  const mentionRegex = /@([^\s@]+)/g

  for (const msg of messages) {
    const matches = msg.content.matchAll(mentionRegex)
    const mentionedInThisMsg = new Set<number>()

    for (const match of matches) {
      const mentionedName = match[1]
      const mentionedId = nameToMemberId.get(mentionedName)

      if (mentionedId && mentionedId !== msg.senderId && !mentionedInThisMsg.has(mentionedId)) {
        mentionedInThisMsg.add(mentionedId)

        if (!mentionMatrix.has(msg.senderId)) {
          mentionMatrix.set(msg.senderId, new Map())
        }
        const fromMap = mentionMatrix.get(msg.senderId)!
        fromMap.set(mentionedId, (fromMap.get(mentionedId) || 0) + 1)
      }
    }
  }

  // 3. 构建 nodes（只包含有互动的成员）
  const involvedMemberIds = new Set<number>()
  for (const [fromId, toMap] of mentionMatrix.entries()) {
    involvedMemberIds.add(fromId)
    for (const toId of toMap.keys()) {
      involvedMemberIds.add(toId)
    }
  }

  const maxMessageCount = Math.max(...members.filter((m) => involvedMemberIds.has(m.id)).map((m) => m.messageCount), 1)

  const nodes: Array<{ id: number | string; name: string; value: number; symbolSize: number }> = []
  for (const memberId of involvedMemberIds) {
    const info = memberIdToInfo.get(memberId)
    if (info) {
      const symbolSize = 20 + (info.messageCount / maxMessageCount) * 40
      nodes.push({
        id: memberId,
        name: info.name,
        value: info.messageCount,
        symbolSize: Math.round(symbolSize),
      })
    }
  }

  // 4. 构建 links
  const links: Array<{ source: string; target: string; value: number }> = []
  let maxLinkValue = 0

  for (const [fromId, toMap] of mentionMatrix.entries()) {
    const fromInfo = memberIdToInfo.get(fromId)
    if (!fromInfo) continue

    for (const [toId, count] of toMap.entries()) {
      const toInfo = memberIdToInfo.get(toId)
      if (!toInfo) continue

      links.push({
        source: fromInfo.name,
        target: toInfo.name,
        value: count,
      })
      maxLinkValue = Math.max(maxLinkValue, count)
    }
  }

  return { nodes, links, maxLinkValue }
}

/**
 * 加载互动关系图数据
 * 组合三个 SQL 查询 + Worker compute 完成全部逻辑
 */
export async function loadMentionGraph(sessionId: string, timeFilter?: TimeFilter): Promise<MentionGraphData> {
  const emptyResult: MentionGraphData = { nodes: [], links: [], maxLinkValue: 0 }

  try {
    // 并行执行三个查询
    const [members, nameHistory, messages] = await Promise.all([
      queryMembers(sessionId, timeFilter),
      queryNameHistory(sessionId),
      queryMentionMessages(sessionId, timeFilter),
    ])

    if (members.length === 0) return emptyResult

    // 在 Worker 中构建关系图
    const result = await window.chatApi.pluginCompute<MentionGraphData>(buildMentionGraph.toString(), {
      members,
      nameHistory,
      messages,
    })

    return result
  } catch (error) {
    console.error('[chart-interaction] Failed to load mention graph:', error)
    return emptyResult
  }
}
