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
const MAX_CLUSTER_LOOK_AHEAD = 10
const DEFAULT_SELECTED_PROXIMITY_MAX_GAP_SECONDS = 1800
const CO_OCCURRENCE_MESSAGE_BATCH_SIZE = 20_000

function resolveClusterOptions(options?: ClusterGraphOptions): Required<ClusterGraphOptions> {
  const requestedLookAhead = options?.lookAhead ?? DEFAULT_CLUSTER_OPTIONS.lookAhead
  const lookAhead = Number.isFinite(requestedLookAhead)
    ? Math.min(MAX_CLUSTER_LOOK_AHEAD, Math.max(0, Math.ceil(requestedLookAhead)))
    : DEFAULT_CLUSTER_OPTIONS.lookAhead
  return {
    lookAhead,
    decaySeconds: options?.decaySeconds ?? DEFAULT_CLUSTER_OPTIONS.decaySeconds,
    topEdges: options?.topEdges ?? DEFAULT_CLUSTER_OPTIONS.topEdges,
  }
}

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
  const opts = resolveClusterOptions(options)
  const pairStatsBySource = new Map<number, Map<number, CoOccurrencePairStats>>()
  const pairs: CoOccurrencePairStats[] = []

  for (let index = 0; index < messages.length - 1; index++) {
    const anchor = messages[index]
    const seenPartners = new Set<number>()
    let partnersFound = 0
    for (let nextIndex = index + 1; nextIndex < messages.length && partnersFound < opts.lookAhead; nextIndex++) {
      const candidate = messages[nextIndex]
      if (candidate.senderId === anchor.senderId || seenPartners.has(candidate.senderId)) continue
      seenPartners.add(candidate.senderId)
      partnersFound++
      const decayWeight = Math.exp(-(candidate.ts - anchor.ts) / opts.decaySeconds)
      const positionWeight = 1 - (partnersFound - 1) * 0.2
      applyCoOccurrencePair(
        anchor.senderId,
        candidate.senderId,
        candidate.ts,
        decayWeight * positionWeight,
        pairStatsBySource,
        pairs
      )
    }
  }

  return pairs
}

export function accumulateCoOccurrencePairBatches(
  batches: Iterable<readonly CoOccurrenceMessage[]>,
  options?: ClusterGraphOptions
): CoOccurrencePairStats[] {
  const senderChunks: Float64Array[] = []
  const timestampChunks: Float64Array[] = []
  let messageCount = 0

  for (const batch of batches) {
    if (batch.length === 0) continue
    const senderIds = new Float64Array(batch.length)
    const timestamps = new Float64Array(batch.length)
    for (let index = 0; index < batch.length; index++) {
      senderIds[index] = batch[index].senderId
      timestamps[index] = batch[index].ts
    }
    senderChunks.push(senderIds)
    timestampChunks.push(timestamps)
    messageCount += batch.length
  }

  const senderIds = mergeNumberChunks(senderChunks, messageCount)
  const timestamps = mergeNumberChunks(timestampChunks, messageCount)
  senderChunks.length = 0
  timestampChunks.length = 0
  return accumulateCoOccurrenceColumns(senderIds, timestamps, options)
}

function mergeNumberChunks(chunks: Float64Array[], totalLength: number): Float64Array {
  if (chunks.length === 1) return chunks[0]
  const merged = new Float64Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  return merged
}

function accumulateCoOccurrenceColumns(
  senderIds: Float64Array,
  timestamps: Float64Array,
  options?: ClusterGraphOptions
): CoOccurrencePairStats[] {
  const opts = resolveClusterOptions(options)
  const lookAhead = opts.lookAhead
  const candidateIndexes = buildDistinctSpeakerLookAhead(senderIds.length, (index) => senderIds[index], lookAhead)
  const pairStatsBySource = new Map<number, Map<number, CoOccurrencePairStats>>()
  const pairs: CoOccurrencePairStats[] = []

  for (let index = 0; index < senderIds.length - 1; index++) {
    for (let partnerIndex = 0; partnerIndex < lookAhead; partnerIndex++) {
      const candidateIndex = candidateIndexes[index * lookAhead + partnerIndex]
      if (candidateIndex < 0) break
      const decayWeight = Math.exp(-(timestamps[candidateIndex] - timestamps[index]) / opts.decaySeconds)
      const positionWeight = 1 - partnerIndex * 0.2
      applyCoOccurrencePair(
        senderIds[index],
        senderIds[candidateIndex],
        timestamps[candidateIndex],
        decayWeight * positionWeight,
        pairStatsBySource,
        pairs
      )
    }
  }

  return pairs
}

function applyCoOccurrencePair(
  leftSenderId: number,
  rightSenderId: number,
  timestamp: number,
  weight: number,
  pairStatsBySource: Map<number, Map<number, CoOccurrencePairStats>>,
  pairs: CoOccurrencePairStats[]
): void {
  const sourceId = Math.min(leftSenderId, rightSenderId)
  const targetId = Math.max(leftSenderId, rightSenderId)
  let pairStatsByTarget = pairStatsBySource.get(sourceId)
  if (!pairStatsByTarget) {
    pairStatsByTarget = new Map()
    pairStatsBySource.set(sourceId, pairStatsByTarget)
  }
  let pair = pairStatsByTarget.get(targetId)
  if (!pair) {
    pair = { sourceId, targetId, rawScore: 0, coOccurrenceCount: 0, lastOccurrenceTs: 0 }
    pairStatsByTarget.set(targetId, pair)
    pairs.push(pair)
  }
  pair.rawScore += weight
  pair.coOccurrenceCount++
  pair.lastOccurrenceTs = Math.max(pair.lastOccurrenceTs, timestamp)
}

/**
 * Compute only requested member pairs while preserving the full message stream
 * when deciding which distinct speakers occupy the look-ahead window.
 */
export function accumulateSelectedCoOccurrencePairs(
  messages: IdentifiedCoOccurrenceMessage[],
  selectedPairs: Array<readonly [number, number]>,
  options?: ClusterGraphOptions & { maxAnchorsPerPair?: number; maxGapSeconds?: number }
): SelectedCoOccurrencePairStats[] {
  const opts = resolveClusterOptions(options)
  const lookAhead = opts.lookAhead
  const maxAnchorsPerPair = Math.max(0, Math.floor(options?.maxAnchorsPerPair ?? 2))
  const maxGapSeconds = Math.max(0, options?.maxGapSeconds ?? DEFAULT_SELECTED_PROXIMITY_MAX_GAP_SECONDS)
  const selectedKeys = new Set(selectedPairs.map(([left, right]) => clusterPairKey(left, right)))
  const candidateIndexes = buildDistinctSpeakerLookAhead(
    messages.length,
    (index) => messages[index].senderId,
    lookAhead
  )
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
      const deltaSeconds = candidate.ts - anchor.ts
      if (deltaSeconds > maxGapSeconds) break
      const key = clusterPairKey(anchor.senderId, candidate.senderId)
      if (!selectedKeys.has(key)) continue
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
function buildDistinctSpeakerLookAhead(
  messageCount: number,
  senderIdAt: (index: number) => number,
  lookAhead: number
): Int32Array {
  const candidateIndexes = new Int32Array(messageCount * lookAhead)
  candidateIndexes.fill(-1)
  if (lookAhead === 0 || messageCount === 0) return candidateIndexes

  const previousIndexes = new Int32Array(messageCount)
  const nextIndexes = new Int32Array(messageCount)
  previousIndexes.fill(-1)
  nextIndexes.fill(-1)
  const activeIndexBySender = new Map<number, number>()
  let headIndex = -1

  for (let index = messageCount - 1; index >= 0; index--) {
    const senderId = senderIdAt(index)
    let candidateIndex = headIndex
    let found = 0
    while (candidateIndex >= 0 && found < lookAhead) {
      if (senderIdAt(candidateIndex) !== senderId) {
        candidateIndexes[index * lookAhead + found] = candidateIndex
        found++
      }
      candidateIndex = nextIndexes[candidateIndex]
    }

    const previousOccurrence = activeIndexBySender.get(senderId)
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
    activeIndexBySender.set(senderId, index)
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
  const opts = resolveClusterOptions(options)
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

  const memberMsgCount = new Map<number, number>()
  let totalMessages = 0
  const trackedMessageBatches = (function* () {
    for (const batch of queryClusterMessageBatches(db, filter)) {
      for (const message of batch) {
        memberMsgCount.set(message.senderId, (memberMsgCount.get(message.senderId) || 0) + 1)
        totalMessages++
      }
      yield batch
    }
  })()
  const coOccurrencePairs = accumulateCoOccurrencePairBatches(trackedMessageBatches, opts)

  if (totalMessages < 2)
    return {
      ...emptyResult,
      stats: { ...emptyResult.stats, totalMembers: members.length, totalMessages },
    }

  const lookAheadFactor = opts.lookAhead * 0.8
  const rawEdges: Array<{
    sourceId: number
    targetId: number
    rawScore: number
    expectedScore: number
    normalizedScore: number
    coOccurrenceCount: number
  }> = []

  for (const pair of coOccurrencePairs) {
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
      stats: { ...emptyResult.stats, totalMembers: members.length, totalMessages },
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
      totalMessages,
      involvedMembers: involvedIds.size,
      edgeCount: keptEdges.length,
      communityCount: 0,
    },
  }
}

function* queryClusterMessageBatches(
  db: DatabaseAdapter,
  filter?: TimeFilter
): Generator<Array<{ senderId: number; ts: number }>> {
  const { clause, params } = buildTimeFilter(filter, 'msg')
  const systemMemberCondition = "COALESCE(m.account_name, '') != '系统消息'"
  const firstWhere = appendSocialConditions(clause, [systemMemberCondition])
  const nextWhere = appendSocialConditions(clause, [systemMemberCondition, '(msg.ts, msg.id) > (?, ?)'])
  const firstPage = db.prepare(
    `SELECT msg.id, msg.sender_id as senderId, msg.ts
     FROM message msg JOIN member m ON msg.sender_id = m.id
     ${firstWhere}
     ORDER BY msg.ts ASC, msg.id ASC
     LIMIT ?`
  )
  const nextPage = db.prepare(
    `SELECT msg.id, msg.sender_id as senderId, msg.ts
     FROM message msg JOIN member m ON msg.sender_id = m.id
     ${nextWhere}
     ORDER BY msg.ts ASC, msg.id ASC
     LIMIT ?`
  )

  let rows = firstPage.all(...params, CO_OCCURRENCE_MESSAGE_BATCH_SIZE) as Array<{
    id: number
    senderId: number
    ts: number
  }>
  while (rows.length > 0) {
    yield rows
    if (rows.length < CO_OCCURRENCE_MESSAGE_BATCH_SIZE) break
    const last = rows[rows.length - 1]
    rows = nextPage.all(...params, last.ts, last.id, CO_OCCURRENCE_MESSAGE_BATCH_SIZE) as Array<{
      id: number
      senderId: number
      ts: number
    }>
  }
}

function appendSocialConditions(clause: string, conditions: string[]): string {
  const existing = clause.trim().replace(/^WHERE\s+/i, '')
  return `WHERE ${[existing, ...conditions].filter(Boolean).join(' AND ')}`
}
