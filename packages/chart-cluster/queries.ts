/**
 * chart-cluster 数据查询
 *
 * 将原 getClusterGraph 后端函数拆解为：
 * 1. 两个 SQL 查询获取原始数据（成员 + 消息）
 * 2. 一个 compute 在 Worker 中完成全部计算逻辑
 *    （时间衰减评分、归一化、混合评分、排序、节点度数计算）
 */

import type { MemberRow, MessageRow, ClusterGraphData, ClusterGraphOptions, BuildClusterInput } from './types'

interface TimeFilter {
  startTs?: number
  endTs?: number
  memberId?: number | null
}

const DEFAULT_OPTIONS: Required<ClusterGraphOptions> = {
  lookAhead: 3,
  decaySeconds: 120,
  topEdges: 150,
}

const SYSTEM_FILTER = "AND COALESCE(m.account_name, '') != '系统消息'"

/**
 * 构建时间过滤条件
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

  return { conditions: parts.join(' '), params }
}

/**
 * 查询所有成员（含消息数）
 */
async function queryMembers(sessionId: string): Promise<MemberRow[]> {
  return window.chatApi.pluginQuery<MemberRow>(
    sessionId,
    `SELECT
       id,
       platform_id as platformId,
       COALESCE(group_nickname, account_name, platform_id) as name,
       (SELECT COUNT(*) FROM message WHERE sender_id = member.id) as messageCount
     FROM member
     WHERE COALESCE(account_name, '') != '系统消息'`
  )
}

/**
 * 查询消息列表（按时间排序）
 */
async function queryMessages(sessionId: string, timeFilter?: TimeFilter): Promise<MessageRow[]> {
  const { conditions, params } = buildFilter(timeFilter)

  return window.chatApi.pluginQuery<MessageRow>(
    sessionId,
    `SELECT msg.sender_id as senderId, msg.ts as ts
     FROM message msg
     JOIN member m ON msg.sender_id = m.id
     WHERE 1=1 ${SYSTEM_FILTER} ${conditions}
     ORDER BY msg.ts ASC, msg.id ASC`,
    params
  )
}

/**
 * 在 Worker 中执行的纯函数 —— 小团体关系图计算核心
 *
 * ⚠️ 此函数会被序列化后在 Worker 中执行，
 *    所有逻辑和辅助函数都必须内联，不能引用外部变量。
 */
function buildClusterGraph(input: BuildClusterInput): ClusterGraphData {
  const { members, messages, options } = input

  // 内联辅助函数
  function pairKey(a: number, b: number): string {
    return a < b ? `${a}-${b}` : `${b}-${a}`
  }

  function roundNum(n: number): number {
    return Math.round(n * 100) / 100
  }

  const emptyResult: ClusterGraphData = {
    nodes: [],
    links: [],
    maxLinkValue: 0,
    communities: [],
    stats: { totalMembers: 0, totalMessages: 0, involvedMembers: 0, edgeCount: 0, communityCount: 0 },
  }

  if (members.length < 2) {
    return { ...emptyResult, stats: { ...emptyResult.stats, totalMembers: members.length } }
  }

  // 1. 构建成员信息映射
  const memberInfo = new Map<number, { name: string; platformId: string; messageCount: number }>()
  for (const m of members) {
    memberInfo.set(m.id, { name: m.name, platformId: m.platformId, messageCount: m.messageCount })
  }

  if (messages.length < 2) {
    return {
      ...emptyResult,
      stats: { ...emptyResult.stats, totalMembers: members.length, totalMessages: messages.length },
    }
  }

  // 2. 统计过滤后的成员消息数
  const memberMsgCount = new Map<number, number>()
  for (const msg of messages) {
    memberMsgCount.set(msg.senderId, (memberMsgCount.get(msg.senderId) || 0) + 1)
  }
  const totalMessages = messages.length

  // 3. 计算成员对的原始相邻分数
  const pairRawScore = new Map<string, number>()
  const pairCoOccurrence = new Map<string, number>()

  for (let i = 0; i < messages.length - 1; i++) {
    const anchor = messages[i]
    const seenPartners = new Set<number>()
    let partnersFound = 0

    for (let j = i + 1; j < messages.length && partnersFound < options.lookAhead; j++) {
      const candidate = messages[j]
      if (candidate.senderId === anchor.senderId) continue
      if (seenPartners.has(candidate.senderId)) continue

      seenPartners.add(candidate.senderId)
      partnersFound++

      const deltaSeconds = (candidate.ts - anchor.ts) / 1000
      const decayWeight = Math.exp(-deltaSeconds / options.decaySeconds)
      const positionWeight = 1 - (partnersFound - 1) * 0.2

      const weight = decayWeight * positionWeight
      const key = pairKey(anchor.senderId, candidate.senderId)

      pairRawScore.set(key, (pairRawScore.get(key) || 0) + weight)
      pairCoOccurrence.set(key, (pairCoOccurrence.get(key) || 0) + 1)
    }
  }

  // 4. 归一化
  const lookAheadFactor = options.lookAhead * 0.8

  const rawEdges: Array<{
    sourceId: number
    targetId: number
    rawScore: number
    expectedScore: number
    normalizedScore: number
    coOccurrenceCount: number
  }> = []

  for (const [key, rawScore] of pairRawScore) {
    const [aIdStr, bIdStr] = key.split('-')
    const aId = parseInt(aIdStr)
    const bId = parseInt(bIdStr)

    const aMsgCount = memberMsgCount.get(aId) || 0
    const bMsgCount = memberMsgCount.get(bId) || 0

    const expectedScore = ((aMsgCount * bMsgCount) / totalMessages) * lookAheadFactor
    const normalizedScore = expectedScore > 0 ? rawScore / expectedScore : 0

    rawEdges.push({
      sourceId: aId,
      targetId: bId,
      rawScore,
      expectedScore,
      normalizedScore,
      coOccurrenceCount: pairCoOccurrence.get(key) || 0,
    })
  }

  // 5. 计算混合分数
  const maxRawScore = Math.max(...rawEdges.map((e) => e.rawScore), 1)
  const maxNormalizedScore = Math.max(...rawEdges.map((e) => e.normalizedScore), 1)

  const edges = rawEdges.map((e) => {
    const hybridScore = 0.5 * (e.rawScore / maxRawScore) + 0.5 * (e.normalizedScore / maxNormalizedScore)
    return {
      ...e,
      rawScore: roundNum(e.rawScore),
      expectedScore: roundNum(e.expectedScore),
      normalizedScore: roundNum(e.normalizedScore),
      hybridScore: roundNum(hybridScore),
    }
  })

  // 6. 排序取 Top N
  edges.sort((a, b) => b.hybridScore - a.hybridScore)
  const keptEdges = edges.slice(0, options.topEdges)

  if (keptEdges.length === 0) {
    return {
      ...emptyResult,
      stats: { ...emptyResult.stats, totalMembers: members.length, totalMessages: messages.length },
    }
  }

  // 7. 找出参与的成员
  const involvedIds = new Set<number>()
  for (const edge of keptEdges) {
    involvedIds.add(edge.sourceId)
    involvedIds.add(edge.targetId)
  }

  // 8. 计算节点度数
  const nodeDegree = new Map<number, number>()
  for (const edge of keptEdges) {
    nodeDegree.set(edge.sourceId, (nodeDegree.get(edge.sourceId) || 0) + edge.hybridScore)
    nodeDegree.set(edge.targetId, (nodeDegree.get(edge.targetId) || 0) + edge.hybridScore)
  }
  const maxDegree = Math.max(...nodeDegree.values(), 1)

  // 9. 构建显示名（处理同名）
  const nameCount = new Map<string, number>()
  for (const id of involvedIds) {
    const name = memberInfo.get(id)?.name || String(id)
    nameCount.set(name, (nameCount.get(name) || 0) + 1)
  }

  const displayNames = new Map<number, string>()
  for (const id of involvedIds) {
    const info = memberInfo.get(id)
    const baseName = info?.name || String(id)
    if ((nameCount.get(baseName) || 0) > 1) {
      displayNames.set(id, `${baseName}#${(info?.platformId || String(id)).slice(-4)}`)
    } else {
      displayNames.set(id, baseName)
    }
  }

  // 10. 构建输出
  const maxMsgCount = Math.max(...[...involvedIds].map((id) => memberInfo.get(id)?.messageCount || 0), 1)

  const nodes = [...involvedIds].map((id) => {
    const info = memberInfo.get(id)!
    const degree = nodeDegree.get(id) || 0
    const normalizedDegree = degree / maxDegree
    const msgNorm = info.messageCount / maxMsgCount
    const symbolSize = 20 + (0.7 * normalizedDegree + 0.3 * msgNorm) * 35

    return {
      id,
      name: displayNames.get(id)!,
      messageCount: info.messageCount,
      symbolSize: Math.round(symbolSize),
      degree: roundNum(degree),
      normalizedDegree: roundNum(normalizedDegree),
    }
  })

  nodes.sort((a, b) => b.degree - a.degree)

  const maxLinkValue = keptEdges.length > 0 ? Math.max(...keptEdges.map((e) => e.hybridScore)) : 0

  const links = keptEdges.map((e) => ({
    source: displayNames.get(e.sourceId)!,
    target: displayNames.get(e.targetId)!,
    value: e.hybridScore,
    rawScore: e.rawScore,
    expectedScore: e.expectedScore,
    coOccurrenceCount: e.coOccurrenceCount,
  }))

  return {
    nodes,
    links,
    maxLinkValue: roundNum(maxLinkValue),
    communities: [],
    stats: {
      totalMembers: members.length,
      totalMessages: messages.length,
      involvedMembers: involvedIds.size,
      edgeCount: keptEdges.length,
      communityCount: 0,
    },
  }
}

/**
 * 加载小团体关系图数据
 */
export async function loadClusterGraph(
  sessionId: string,
  timeFilter?: TimeFilter,
  userOptions?: ClusterGraphOptions
): Promise<ClusterGraphData> {
  const emptyResult: ClusterGraphData = {
    nodes: [],
    links: [],
    maxLinkValue: 0,
    communities: [],
    stats: { totalMembers: 0, totalMessages: 0, involvedMembers: 0, edgeCount: 0, communityCount: 0 },
  }

  try {
    const [members, messages] = await Promise.all([queryMembers(sessionId), queryMessages(sessionId, timeFilter)])

    if (members.length < 2 || messages.length < 2) {
      return {
        ...emptyResult,
        stats: { ...emptyResult.stats, totalMembers: members.length, totalMessages: messages.length },
      }
    }

    const mergedOptions: Required<ClusterGraphOptions> = {
      ...DEFAULT_OPTIONS,
      ...userOptions,
    }

    const result = await window.chatApi.pluginCompute<ClusterGraphData>(buildClusterGraph.toString(), {
      members,
      messages,
      options: mergedOptions,
    })

    return result
  } catch (error) {
    console.error('[chart-cluster] Failed to load cluster graph:', error)
    return emptyResult
  }
}
