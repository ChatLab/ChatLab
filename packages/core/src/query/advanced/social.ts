/**
 * 社交分析模块（平台无关）
 * 包含：@ 互动分析、含笑量分析、小团体关系图
 */

import type { TimeFilter } from '@openchatlab/shared-types'
import type { DatabaseAdapter } from '../../interfaces'
import { buildTimeFilter } from '../filters'

// ==================== @ 互动分析 ====================

export function getMentionAnalysis(db: DatabaseAdapter, filter?: TimeFilter): any {
  const emptyResult = {
    topMentioners: [],
    topMentioned: [],
    oneWay: [],
    twoWay: [],
    totalMentions: 0,
    memberDetails: [],
  }

  const members = db
    .prepare(
      `SELECT id, platform_id as platformId, COALESCE(group_nickname, account_name, platform_id) as name
       FROM member WHERE COALESCE(account_name, '') != '系统消息'`
    )
    .all() as Array<{ id: number; platformId: string; name: string }>

  if (members.length === 0) return emptyResult

  const nameToMemberId = new Map<string, number>()
  const memberIdToInfo = new Map<number, { platformId: string; name: string }>()

  for (const member of members) {
    memberIdToInfo.set(member.id, { platformId: member.platformId, name: member.name })
    nameToMemberId.set(member.name, member.id)

    const history = db.prepare('SELECT name FROM member_name_history WHERE member_id = ?').all(member.id) as Array<{
      name: string
    }>

    for (const h of history) {
      if (!nameToMemberId.has(h.name)) {
        nameToMemberId.set(h.name, member.id)
      }
    }
  }

  const { clause, params } = buildTimeFilter(filter)
  let whereClause = clause
  if (whereClause.includes('WHERE')) {
    whereClause +=
      " AND COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND msg.content LIKE '%@%'"
  } else {
    whereClause =
      " WHERE COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND msg.content LIKE '%@%'"
  }

  const messages = db
    .prepare(
      `SELECT msg.sender_id as senderId, msg.content
       FROM message msg JOIN member m ON msg.sender_id = m.id ${whereClause}`
    )
    .all(...params) as Array<{ senderId: number; content: string }>

  const mentionMatrix = new Map<number, Map<number, number>>()
  const mentionedCount = new Map<number, number>()
  const mentionerCount = new Map<number, number>()
  let totalMentions = 0
  const mentionRegex = /@([^\s@]+)/g

  for (const msg of messages) {
    const matches = msg.content.matchAll(mentionRegex)
    const mentionedInThisMsg = new Set<number>()

    for (const match of matches) {
      const mentionedId = nameToMemberId.get(match[1])
      if (mentionedId && mentionedId !== msg.senderId && !mentionedInThisMsg.has(mentionedId)) {
        mentionedInThisMsg.add(mentionedId)
        totalMentions++

        if (!mentionMatrix.has(msg.senderId)) mentionMatrix.set(msg.senderId, new Map())
        const fromMap = mentionMatrix.get(msg.senderId)!
        fromMap.set(mentionedId, (fromMap.get(mentionedId) || 0) + 1)

        mentionerCount.set(msg.senderId, (mentionerCount.get(msg.senderId) || 0) + 1)
        mentionedCount.set(mentionedId, (mentionedCount.get(mentionedId) || 0) + 1)
      }
    }
  }

  if (totalMentions === 0) return emptyResult

  const topMentioners: any[] = []
  for (const [memberId, count] of mentionerCount.entries()) {
    const info = memberIdToInfo.get(memberId)!
    topMentioners.push({
      memberId,
      platformId: info.platformId,
      name: info.name,
      count,
      percentage: Math.round((count / totalMentions) * 10000) / 100,
    })
  }
  topMentioners.sort((a, b) => b.count - a.count)

  const topMentioned: any[] = []
  for (const [memberId, count] of mentionedCount.entries()) {
    const info = memberIdToInfo.get(memberId)!
    topMentioned.push({
      memberId,
      platformId: info.platformId,
      name: info.name,
      count,
      percentage: Math.round((count / totalMentions) * 10000) / 100,
    })
  }
  topMentioned.sort((a, b) => b.count - a.count)

  const oneWay: any[] = []
  const processedPairs = new Set<string>()
  for (const [fromId, toMap] of mentionMatrix.entries()) {
    for (const [toId, fromToCount] of toMap.entries()) {
      const pairKey = `${Math.min(fromId, toId)}-${Math.max(fromId, toId)}`
      if (processedPairs.has(pairKey)) continue
      processedPairs.add(pairKey)
      const toFromCount = mentionMatrix.get(toId)?.get(fromId) || 0
      const total = fromToCount + toFromCount
      if (total < 3) continue
      const ratio = fromToCount / total
      if (ratio >= 0.8) {
        const fromInfo = memberIdToInfo.get(fromId)!
        const toInfo = memberIdToInfo.get(toId)!
        oneWay.push({
          fromMemberId: fromId,
          fromName: fromInfo.name,
          toMemberId: toId,
          toName: toInfo.name,
          fromToCount,
          toFromCount,
          ratio: Math.round(ratio * 100) / 100,
        })
      } else if (ratio <= 0.2) {
        const fromInfo = memberIdToInfo.get(fromId)!
        const toInfo = memberIdToInfo.get(toId)!
        oneWay.push({
          fromMemberId: toId,
          fromName: toInfo.name,
          toMemberId: fromId,
          toName: fromInfo.name,
          fromToCount: toFromCount,
          toFromCount: fromToCount,
          ratio: Math.round((1 - ratio) * 100) / 100,
        })
      }
    }
  }
  oneWay.sort((a, b) => b.fromToCount - a.fromToCount)

  const twoWay: any[] = []
  processedPairs.clear()
  for (const [fromId, toMap] of mentionMatrix.entries()) {
    for (const [toId, fromToCount] of toMap.entries()) {
      const pairKey = `${Math.min(fromId, toId)}-${Math.max(fromId, toId)}`
      if (processedPairs.has(pairKey)) continue
      processedPairs.add(pairKey)
      const toFromCount = mentionMatrix.get(toId)?.get(fromId) || 0
      const total = fromToCount + toFromCount
      if (total < 5 || toFromCount === 0 || fromToCount === 0) continue
      const ratio = Math.min(fromToCount, toFromCount) / Math.max(fromToCount, toFromCount)
      if (ratio >= 0.3) {
        const m1Info = memberIdToInfo.get(fromId)!
        const m2Info = memberIdToInfo.get(toId)!
        twoWay.push({
          member1Id: fromId,
          member1Name: m1Info.name,
          member2Id: toId,
          member2Name: m2Info.name,
          member1To2: fromToCount,
          member2To1: toFromCount,
          total,
          balance: Math.round(ratio * 100) / 100,
        })
      }
    }
  }
  twoWay.sort((a, b) => b.total - a.total)

  const memberDetails: any[] = []
  for (const member of members) {
    const info = memberIdToInfo.get(member.id)!
    const topMentionedByThis: any[] = []
    const toMap = mentionMatrix.get(member.id)
    if (toMap) {
      for (const [toId, count] of toMap.entries()) {
        const toInfo = memberIdToInfo.get(toId)!
        topMentionedByThis.push({
          fromMemberId: member.id,
          fromName: info.name,
          toMemberId: toId,
          toName: toInfo.name,
          count,
        })
      }
      topMentionedByThis.sort((a, b) => b.count - a.count)
    }
    const topMentionersOfThis: any[] = []
    for (const [fromId, fToMap] of mentionMatrix.entries()) {
      const count = fToMap.get(member.id)
      if (count) {
        const fromInfo = memberIdToInfo.get(fromId)!
        topMentionersOfThis.push({
          fromMemberId: fromId,
          fromName: fromInfo.name,
          toMemberId: member.id,
          toName: info.name,
          count,
        })
      }
    }
    topMentionersOfThis.sort((a, b) => b.count - a.count)
    if (topMentionedByThis.length > 0 || topMentionersOfThis.length > 0) {
      memberDetails.push({
        memberId: member.id,
        name: info.name,
        topMentioned: topMentionedByThis.slice(0, 5),
        topMentioners: topMentionersOfThis.slice(0, 5),
      })
    }
  }

  return { topMentioners, topMentioned, oneWay, twoWay, totalMentions, memberDetails }
}

// ==================== @ 互动关系图数据 ====================

export interface MentionGraphNode {
  id: number
  name: string
  value: number
  symbolSize: number
}

export interface MentionGraphLink {
  source: string
  target: string
  value: number
}

export interface MentionGraphData {
  nodes: MentionGraphNode[]
  links: MentionGraphLink[]
  maxLinkValue: number
}

export function getMentionGraph(db: DatabaseAdapter, filter?: TimeFilter): MentionGraphData {
  const emptyResult: MentionGraphData = { nodes: [], links: [], maxLinkValue: 0 }

  const { clause, params } = buildTimeFilter(filter)
  const msgFilterBase = clause ? clause.replace('WHERE', 'AND') : ''
  const msgFilterWithSystem = msgFilterBase + " AND COALESCE(m.account_name, '') != '系统消息'"

  const members = db
    .prepare(
      `SELECT m.id, m.platform_id as platformId, COALESCE(m.group_nickname, m.account_name, m.platform_id) as name,
              COUNT(msg.id) as messageCount
       FROM member m LEFT JOIN message msg ON m.id = msg.sender_id ${msgFilterWithSystem}
       WHERE COALESCE(m.account_name, '') != '系统消息' GROUP BY m.id`
    )
    .all(...params) as Array<{ id: number; platformId: string; name: string; messageCount: number }>

  if (members.length === 0) return emptyResult

  const nameToMemberId = new Map<string, number>()
  const memberIdToInfo = new Map<number, { name: string; messageCount: number }>()

  for (const member of members) {
    memberIdToInfo.set(member.id, { name: member.name, messageCount: member.messageCount })
    nameToMemberId.set(member.name, member.id)
    const history = db.prepare('SELECT name FROM member_name_history WHERE member_id = ?').all(member.id) as Array<{
      name: string
    }>
    for (const h of history) {
      if (!nameToMemberId.has(h.name)) nameToMemberId.set(h.name, member.id)
    }
  }

  let whereClause = clause
  if (whereClause.includes('WHERE')) {
    whereClause +=
      " AND COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND msg.content LIKE '%@%'"
  } else {
    whereClause =
      " WHERE COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND msg.content LIKE '%@%'"
  }

  const messages = db
    .prepare(
      `SELECT msg.sender_id as senderId, msg.content FROM message msg JOIN member m ON msg.sender_id = m.id ${whereClause}`
    )
    .all(...params) as Array<{ senderId: number; content: string }>

  const mentionMatrix = new Map<number, Map<number, number>>()
  const mentionRegex = /@([^\s@]+)/g

  for (const msg of messages) {
    const matches = msg.content.matchAll(mentionRegex)
    const mentionedInThisMsg = new Set<number>()
    for (const match of matches) {
      const mentionedId = nameToMemberId.get(match[1])
      if (mentionedId && mentionedId !== msg.senderId && !mentionedInThisMsg.has(mentionedId)) {
        mentionedInThisMsg.add(mentionedId)
        if (!mentionMatrix.has(msg.senderId)) mentionMatrix.set(msg.senderId, new Map())
        const fromMap = mentionMatrix.get(msg.senderId)!
        fromMap.set(mentionedId, (fromMap.get(mentionedId) || 0) + 1)
      }
    }
  }

  const involvedMemberIds = new Set<number>()
  for (const [fromId, toMap] of mentionMatrix.entries()) {
    involvedMemberIds.add(fromId)
    for (const toId of toMap.keys()) involvedMemberIds.add(toId)
  }

  const maxMessageCount = Math.max(...members.filter((m) => involvedMemberIds.has(m.id)).map((m) => m.messageCount), 1)
  const nodes: MentionGraphNode[] = []
  for (const memberId of involvedMemberIds) {
    const info = memberIdToInfo.get(memberId)
    if (info) {
      const symbolSize = 20 + (info.messageCount / maxMessageCount) * 40
      nodes.push({ id: memberId, name: info.name, value: info.messageCount, symbolSize: Math.round(symbolSize) })
    }
  }

  const links: MentionGraphLink[] = []
  let maxLinkValue = 0
  for (const [fromId, toMap] of mentionMatrix.entries()) {
    const fromInfo = memberIdToInfo.get(fromId)
    if (!fromInfo) continue
    for (const [toId, count] of toMap.entries()) {
      const toInfo = memberIdToInfo.get(toId)
      if (!toInfo) continue
      links.push({ source: fromInfo.name, target: toInfo.name, value: count })
      maxLinkValue = Math.max(maxLinkValue, count)
    }
  }

  return { nodes, links, maxLinkValue }
}

// ==================== 含笑量分析 ====================

function keywordToPattern(keyword: string): string {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (keyword === '哈哈') return '哈哈+'
  return escaped
}

export function getLaughAnalysis(db: DatabaseAdapter, filter?: TimeFilter, keywords?: string[]): any {
  const emptyResult = {
    rankByRate: [],
    rankByCount: [],
    typeDistribution: [],
    totalLaughs: 0,
    totalMessages: 0,
    groupLaughRate: 0,
  }
  const laughKeywords = keywords && keywords.length > 0 ? keywords : []
  const patterns = laughKeywords.map(keywordToPattern)
  const laughRegex = new RegExp(`(${patterns.join('|')})`, 'gi')

  const { clause, params } = buildTimeFilter(filter)
  let whereClause = clause
  if (whereClause.includes('WHERE')) {
    whereClause += " AND COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL"
  } else {
    whereClause = " WHERE COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL"
  }

  const messages = db
    .prepare(
      `SELECT msg.sender_id as senderId, msg.content, m.platform_id as platformId,
              COALESCE(m.group_nickname, m.account_name, m.platform_id) as name
       FROM message msg JOIN member m ON msg.sender_id = m.id ${whereClause}`
    )
    .all(...params) as Array<{ senderId: number; content: string; platformId: string; name: string }>

  if (messages.length === 0) return emptyResult

  const memberStats = new Map<
    number,
    { platformId: string; name: string; laughCount: number; messageCount: number; keywordCounts: Map<string, number> }
  >()
  const typeCount = new Map<string, number>()
  let totalLaughs = 0

  for (const msg of messages) {
    if (!memberStats.has(msg.senderId)) {
      memberStats.set(msg.senderId, {
        platformId: msg.platformId,
        name: msg.name,
        laughCount: 0,
        messageCount: 0,
        keywordCounts: new Map(),
      })
    }
    const stats = memberStats.get(msg.senderId)!
    stats.messageCount++
    const matches = msg.content.match(laughRegex)
    if (matches) {
      stats.laughCount += matches.length
      totalLaughs += matches.length
      for (const match of matches) {
        let matchedType = '其他'
        for (const keyword of laughKeywords) {
          if (new RegExp(`^${keywordToPattern(keyword)}$`, 'i').test(match)) {
            matchedType = keyword
            break
          }
        }
        typeCount.set(matchedType, (typeCount.get(matchedType) || 0) + 1)
        stats.keywordCounts.set(matchedType, (stats.keywordCounts.get(matchedType) || 0) + 1)
      }
    }
  }

  if (totalLaughs === 0) return emptyResult

  const rankItems: any[] = []
  for (const [memberId, stats] of memberStats.entries()) {
    if (stats.laughCount > 0) {
      const keywordDistribution: Array<{ keyword: string; count: number; percentage: number }> = []
      for (const keyword of laughKeywords) {
        const count = stats.keywordCounts.get(keyword) || 0
        if (count > 0)
          keywordDistribution.push({ keyword, count, percentage: Math.round((count / stats.laughCount) * 10000) / 100 })
      }
      const otherCount = stats.keywordCounts.get('其他') || 0
      if (otherCount > 0)
        keywordDistribution.push({
          keyword: '其他',
          count: otherCount,
          percentage: Math.round((otherCount / stats.laughCount) * 10000) / 100,
        })

      rankItems.push({
        memberId,
        platformId: stats.platformId,
        name: stats.name,
        laughCount: stats.laughCount,
        messageCount: stats.messageCount,
        laughRate: Math.round((stats.laughCount / stats.messageCount) * 10000) / 100,
        percentage: Math.round((stats.laughCount / totalLaughs) * 10000) / 100,
        keywordDistribution,
      })
    }
  }

  const typeDistribution: any[] = []
  for (const [type, count] of typeCount.entries()) {
    typeDistribution.push({ type, count, percentage: Math.round((count / totalLaughs) * 10000) / 100 })
  }
  typeDistribution.sort((a, b) => b.count - a.count)

  return {
    rankByRate: [...rankItems].sort((a, b) => b.laughRate - a.laughRate),
    rankByCount: [...rankItems].sort((a, b) => b.laughCount - a.laughCount),
    typeDistribution,
    totalLaughs,
    totalMessages: messages.length,
    groupLaughRate: Math.round((totalLaughs / messages.length) * 10000) / 100,
  }
}

// ==================== 小团体关系图 ====================

export interface ClusterGraphOptions {
  lookAhead?: number
  decaySeconds?: number
  topEdges?: number
}

export interface ClusterGraphNode {
  id: number
  name: string
  messageCount: number
  symbolSize: number
  degree: number
  normalizedDegree: number
}

export interface ClusterGraphLink {
  source: string
  target: string
  value: number
  rawScore: number
  expectedScore: number
  coOccurrenceCount: number
}

export interface ClusterGraphData {
  nodes: ClusterGraphNode[]
  links: ClusterGraphLink[]
  maxLinkValue: number
  communities: Array<{ id: number; name: string; size: number }>
  stats: {
    totalMembers: number
    totalMessages: number
    involvedMembers: number
    edgeCount: number
    communityCount: number
  }
}

export interface CoOccurrenceMessage {
  senderId: number
  ts: number
}

export interface CoOccurrencePairStats {
  sourceId: number
  targetId: number
  rawScore: number
  coOccurrenceCount: number
}

const DEFAULT_CLUSTER_OPTIONS = { lookAhead: 3, decaySeconds: 120, topEdges: 100 }

function roundNum(value: number, digits = 4): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function clusterPairKey(aId: number, bId: number): string {
  return aId < bId ? `${aId}-${bId}` : `${bId}-${aId}`
}

export function accumulateCoOccurrencePairs(
  messages: CoOccurrenceMessage[],
  options?: ClusterGraphOptions
): CoOccurrencePairStats[] {
  const opts = { ...DEFAULT_CLUSTER_OPTIONS, ...options }
  const pairRawScore = new Map<string, number>()
  const pairCoOccurrence = new Map<string, number>()

  // 与小团体图保持同一口径：按消息顺序向后寻找不同发言人，并用时间衰减和位置权重累计关系强度。
  for (let i = 0; i < messages.length - 1; i++) {
    const anchor = messages[i]
    const seenPartners = new Set<number>()
    let partnersFound = 0
    for (let j = i + 1; j < messages.length && partnersFound < opts.lookAhead; j++) {
      const candidate = messages[j]
      if (candidate.senderId === anchor.senderId || seenPartners.has(candidate.senderId)) continue
      seenPartners.add(candidate.senderId)
      partnersFound++
      const deltaSeconds = (candidate.ts - anchor.ts) / 1000
      const decayWeight = Math.exp(-deltaSeconds / opts.decaySeconds)
      const positionWeight = 1 - (partnersFound - 1) * 0.2
      const weight = decayWeight * positionWeight
      const key = clusterPairKey(anchor.senderId, candidate.senderId)
      pairRawScore.set(key, (pairRawScore.get(key) || 0) + weight)
      pairCoOccurrence.set(key, (pairCoOccurrence.get(key) || 0) + 1)
    }
  }

  const pairs: CoOccurrencePairStats[] = []
  for (const [key, rawScore] of pairRawScore) {
    const [sourceIdStr, targetIdStr] = key.split('-')
    pairs.push({
      sourceId: parseInt(sourceIdStr),
      targetId: parseInt(targetIdStr),
      rawScore,
      coOccurrenceCount: pairCoOccurrence.get(key) || 0,
    })
  }

  return pairs
}

export function getClusterGraph(
  db: DatabaseAdapter,
  filter?: TimeFilter,
  options?: ClusterGraphOptions
): ClusterGraphData {
  const opts = { ...DEFAULT_CLUSTER_OPTIONS, ...options }
  const emptyResult: ClusterGraphData = {
    nodes: [],
    links: [],
    maxLinkValue: 0,
    communities: [],
    stats: { totalMembers: 0, totalMessages: 0, involvedMembers: 0, edgeCount: 0, communityCount: 0 },
  }

  const members = db
    .prepare(
      `SELECT id, platform_id as platformId, COALESCE(group_nickname, account_name, platform_id) as name,
              (SELECT COUNT(*) FROM message WHERE sender_id = member.id) as messageCount
       FROM member WHERE COALESCE(account_name, '') != '系统消息'`
    )
    .all() as Array<{ id: number; platformId: string; name: string; messageCount: number }>

  if (members.length < 2) return { ...emptyResult, stats: { ...emptyResult.stats, totalMembers: members.length } }

  const memberInfo = new Map<number, { name: string; platformId: string; messageCount: number }>()
  for (const m of members)
    memberInfo.set(m.id, { name: m.name, platformId: m.platformId, messageCount: m.messageCount })

  const { clause, params } = buildTimeFilter(filter)
  let whereClause = clause
  if (whereClause.includes('WHERE')) {
    whereClause += " AND COALESCE(m.account_name, '') != '系统消息'"
  } else {
    whereClause = " WHERE COALESCE(m.account_name, '') != '系统消息'"
  }

  const messages = db
    .prepare(
      `SELECT msg.sender_id as senderId, msg.ts as ts FROM message msg JOIN member m ON msg.sender_id = m.id
       ${whereClause} ORDER BY msg.ts ASC, msg.id ASC`
    )
    .all(...params) as Array<{ senderId: number; ts: number }>

  if (messages.length < 2)
    return {
      ...emptyResult,
      stats: { ...emptyResult.stats, totalMembers: members.length, totalMessages: messages.length },
    }

  const memberMsgCount = new Map<number, number>()
  for (const msg of messages) memberMsgCount.set(msg.senderId, (memberMsgCount.get(msg.senderId) || 0) + 1)
  const totalMessages = messages.length

  const lookAheadFactor = opts.lookAhead * 0.8
  const rawEdges: Array<{
    sourceId: number
    targetId: number
    rawScore: number
    expectedScore: number
    normalizedScore: number
    coOccurrenceCount: number
  }> = []

  for (const pair of accumulateCoOccurrencePairs(messages, opts)) {
    const aId = pair.sourceId
    const bId = pair.targetId
    const aMsgCount = memberMsgCount.get(aId) || 0
    const bMsgCount = memberMsgCount.get(bId) || 0
    const expectedScore = ((aMsgCount * bMsgCount) / totalMessages) * lookAheadFactor
    const normalizedScore = expectedScore > 0 ? pair.rawScore / expectedScore : 0
    rawEdges.push({
      sourceId: aId,
      targetId: bId,
      rawScore: pair.rawScore,
      expectedScore,
      normalizedScore,
      coOccurrenceCount: pair.coOccurrenceCount,
    })
  }

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

  edges.sort((a, b) => b.hybridScore - a.hybridScore)
  const keptEdges = edges.slice(0, opts.topEdges)

  if (keptEdges.length === 0)
    return {
      ...emptyResult,
      stats: { ...emptyResult.stats, totalMembers: members.length, totalMessages: messages.length },
    }

  const involvedIds = new Set<number>()
  for (const edge of keptEdges) {
    involvedIds.add(edge.sourceId)
    involvedIds.add(edge.targetId)
  }

  const nodeDegree = new Map<number, number>()
  for (const edge of keptEdges) {
    nodeDegree.set(edge.sourceId, (nodeDegree.get(edge.sourceId) || 0) + edge.hybridScore)
    nodeDegree.set(edge.targetId, (nodeDegree.get(edge.targetId) || 0) + edge.hybridScore)
  }
  const maxDegree = Math.max(...nodeDegree.values(), 1)

  const nameCount = new Map<string, number>()
  for (const id of involvedIds) {
    const name = memberInfo.get(id)?.name || String(id)
    nameCount.set(name, (nameCount.get(name) || 0) + 1)
  }

  const displayNames = new Map<number, string>()
  for (const id of involvedIds) {
    const info = memberInfo.get(id)
    const baseName = info?.name || String(id)
    displayNames.set(
      id,
      (nameCount.get(baseName) || 0) > 1 ? `${baseName}#${(info?.platformId || String(id)).slice(-4)}` : baseName
    )
  }

  const maxMsgCount = Math.max(...[...involvedIds].map((id) => memberInfo.get(id)?.messageCount || 0), 1)
  const nodes: ClusterGraphNode[] = [...involvedIds].map((id) => {
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
  const links: ClusterGraphLink[] = keptEdges.map((e) => ({
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
