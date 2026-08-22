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
    totalMentions: 0,
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

  return { topMentioners, topMentioned, totalMentions }
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
  const laughKeywords = keywords?.map((keyword) => keyword.trim()).filter(Boolean) ?? []
  if (laughKeywords.length === 0) return emptyResult

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

export interface IdentifiedCoOccurrenceMessage extends CoOccurrenceMessage {
  messageId: number
}

export interface CoOccurrencePairStats {
  sourceId: number
  targetId: number
  rawScore: number
  coOccurrenceCount: number
  lastOccurrenceTs: number
}

export interface SelectedCoOccurrenceAnchor {
  messageId: number
  relatedMessageId: number
  fromMemberId: number
  toMemberId: number
  timestamp: number
  weight: number
}

export interface SelectedCoOccurrencePairStats extends CoOccurrencePairStats {
  anchors: SelectedCoOccurrenceAnchor[]
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
  const pairLastOccurrenceTs = new Map<string, number>()

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
      const deltaSeconds = candidate.ts - anchor.ts
      const decayWeight = Math.exp(-deltaSeconds / opts.decaySeconds)
      const positionWeight = 1 - (partnersFound - 1) * 0.2
      const weight = decayWeight * positionWeight
      const key = clusterPairKey(anchor.senderId, candidate.senderId)
      pairRawScore.set(key, (pairRawScore.get(key) || 0) + weight)
      pairCoOccurrence.set(key, (pairCoOccurrence.get(key) || 0) + 1)
      pairLastOccurrenceTs.set(key, Math.max(pairLastOccurrenceTs.get(key) ?? 0, candidate.ts))
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
      lastOccurrenceTs: pairLastOccurrenceTs.get(key) ?? 0,
    })
  }

  return pairs
}

/**
 * Compute only requested member pairs while preserving the full message stream
 * when deciding which distinct speakers occupy the look-ahead window.
 */
export function accumulateSelectedCoOccurrencePairs(
  messages: IdentifiedCoOccurrenceMessage[],
  selectedPairs: Array<readonly [number, number]>,
  options?: ClusterGraphOptions & { maxAnchorsPerPair?: number }
): SelectedCoOccurrencePairStats[] {
  const opts = { ...DEFAULT_CLUSTER_OPTIONS, ...options }
  const lookAhead = Math.max(0, Math.ceil(opts.lookAhead))
  const maxAnchorsPerPair = Math.max(0, Math.floor(options?.maxAnchorsPerPair ?? 2))
  const selectedKeys = new Set(selectedPairs.map(([left, right]) => clusterPairKey(left, right)))
  const candidateIndexes = buildDistinctSpeakerLookAhead(messages, lookAhead)
  const stats = new Map<
    string,
    {
      sourceId: number
      targetId: number
      rawScore: number
      coOccurrenceCount: number
      lastOccurrenceTs: number
      anchors: SelectedCoOccurrenceAnchor[]
    }
  >()

  for (let i = 0; i < messages.length - 1; i++) {
    const anchor = messages[i]
    for (let partnerIndex = 0; partnerIndex < lookAhead; partnerIndex++) {
      const candidateIndex = candidateIndexes[i * lookAhead + partnerIndex]
      if (candidateIndex < 0) break
      const candidate = messages[candidateIndex]
      const key = clusterPairKey(anchor.senderId, candidate.senderId)
      if (!selectedKeys.has(key)) continue
      const deltaSeconds = candidate.ts - anchor.ts
      const decayWeight = Math.exp(-deltaSeconds / opts.decaySeconds)
      const positionWeight = 1 - partnerIndex * 0.2
      const weight = decayWeight * positionWeight
      const sourceId = Math.min(anchor.senderId, candidate.senderId)
      const targetId = Math.max(anchor.senderId, candidate.senderId)
      const current = stats.get(key) ?? {
        sourceId,
        targetId,
        rawScore: 0,
        coOccurrenceCount: 0,
        lastOccurrenceTs: 0,
        anchors: [],
      }
      current.rawScore += weight
      current.coOccurrenceCount++
      current.lastOccurrenceTs = Math.max(current.lastOccurrenceTs, candidate.ts)
      retainBestSelectedAnchor(
        current.anchors,
        {
          messageId: candidate.messageId,
          relatedMessageId: anchor.messageId,
          fromMemberId: anchor.senderId,
          toMemberId: candidate.senderId,
          timestamp: candidate.ts,
          weight,
        },
        maxAnchorsPerPair
      )
      stats.set(key, current)
    }
  }

  return [...stats.values()].map((item) => ({
    sourceId: item.sourceId,
    targetId: item.targetId,
    rawScore: item.rawScore,
    coOccurrenceCount: item.coOccurrenceCount,
    lastOccurrenceTs: item.lastOccurrenceTs,
    anchors: item.anchors
      .sort((left, right) => right.weight - left.weight || right.timestamp - left.timestamp)
      .slice(0, maxAnchorsPerPair),
  }))
}

/**
 * 为每条消息预计算其后最先出现的若干位不同发言人。
 *
 * 反向扫描时，链表中只保留每位发言人在当前位置之后的首次出现，且按消息位置升序排列。
 * 因而每条消息只需读取链表头部的 lookAhead 个节点，避免双人长对话反复扫描到数组末尾。
 */
function buildDistinctSpeakerLookAhead(messages: IdentifiedCoOccurrenceMessage[], lookAhead: number): Int32Array {
  const candidateIndexes = new Int32Array(messages.length * lookAhead)
  candidateIndexes.fill(-1)
  if (lookAhead === 0 || messages.length === 0) return candidateIndexes

  const previousIndexes = new Int32Array(messages.length)
  const nextIndexes = new Int32Array(messages.length)
  previousIndexes.fill(-1)
  nextIndexes.fill(-1)
  const activeIndexBySender = new Map<number, number>()
  let headIndex = -1

  for (let index = messages.length - 1; index >= 0; index--) {
    const anchor = messages[index]
    let candidateIndex = headIndex
    let found = 0
    while (candidateIndex >= 0 && found < lookAhead) {
      if (messages[candidateIndex].senderId !== anchor.senderId) {
        candidateIndexes[index * lookAhead + found] = candidateIndex
        found++
      }
      candidateIndex = nextIndexes[candidateIndex]
    }

    const previousOccurrence = activeIndexBySender.get(anchor.senderId)
    if (previousOccurrence !== undefined) {
      const previousIndex = previousIndexes[previousOccurrence]
      const nextIndex = nextIndexes[previousOccurrence]
      if (previousIndex >= 0) nextIndexes[previousIndex] = nextIndex
      else headIndex = nextIndex
      if (nextIndex >= 0) previousIndexes[nextIndex] = previousIndex
    }

    previousIndexes[index] = -1
    nextIndexes[index] = headIndex
    if (headIndex >= 0) previousIndexes[headIndex] = index
    headIndex = index
    activeIndexBySender.set(anchor.senderId, index)
  }

  return candidateIndexes
}

function retainBestSelectedAnchor(
  anchors: SelectedCoOccurrenceAnchor[],
  candidate: SelectedCoOccurrenceAnchor,
  limit: number
): void {
  if (limit === 0) return
  if (anchors.length < limit) {
    anchors.push(candidate)
    return
  }

  let worstIndex = 0
  for (let index = 1; index < anchors.length; index++) {
    if (compareSelectedAnchorQuality(anchors[index], anchors[worstIndex]) < 0) worstIndex = index
  }
  if (compareSelectedAnchorQuality(candidate, anchors[worstIndex]) > 0) anchors[worstIndex] = candidate
}

function compareSelectedAnchorQuality(left: SelectedCoOccurrenceAnchor, right: SelectedCoOccurrenceAnchor): number {
  return left.weight - right.weight || left.timestamp - right.timestamp
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
