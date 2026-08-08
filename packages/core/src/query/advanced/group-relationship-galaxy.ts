import type {
  GroupRelationshipGalaxyData,
  GroupRelationshipGalaxyEdgeDetail,
  GroupRelationshipGalaxyMemberDetail,
  RelationshipGalaxyRenderCommunity,
  RelationshipGalaxyRenderEdge,
  RelationshipGalaxyRenderNode,
  TimeFilter,
} from '@openchatlab/shared-types'
import type { ContactMemberRef } from '../contact-queries'
import { getNonSystemMembersForContacts } from '../contact-queries'
import type { DatabaseAdapter } from '../../interfaces'
import { buildTimeFilter, hasColumn, hasTable } from '../filters'
import { accumulateCoOccurrencePairs } from './social'

export const GROUP_RELATIONSHIP_GALAXY_ALGORITHM_VERSION = 'group-relationship-galaxy-v1'

const REPLY_WEIGHT = 3
const MENTION_WEIGHT = 2
const CO_OCCURRENCE_COUNT_WEIGHT = 0.05
const MIN_EDGE_WEIGHT = 0.000001
const DEFAULT_LIMITS = {
  nodeLimit: 400,
  edgeLimit: 1200,
  perNodeEdgeLimit: 10,
}
const COMMUNITY_COLORS = [
  '#7dd3fc',
  '#c4b5fd',
  '#f0abfc',
  '#5eead4',
  '#fda4af',
  '#fde68a',
  '#93c5fd',
  '#6ee7b7',
  '#d8b4fe',
  '#fdba74',
]

export interface GroupRelationshipGalaxyOptions {
  nodeLimit?: number
  edgeLimit?: number
  perNodeEdgeLimit?: number
}

interface ActiveMember extends ContactMemberRef {
  key: string
  displayName: string
  messageCount: number
  lastMessageTs: number | null
}

interface EdgeAccumulator {
  id: string
  sourceId: number
  targetId: number
  sourceKey: string
  targetKey: string
  coOccurrenceCount: number
  coOccurrenceRawScore: number
  replyInteractionCount: number
  mentionInteractionCount: number
  lastInteractionTs: number | null
  weight: number
}

interface CommunityAssignment {
  id: string
  nodeKeys: string[]
  color: string
  x: number
  y: number
}

export function getGroupRelationshipGalaxy(
  db: DatabaseAdapter,
  filter?: TimeFilter,
  options: GroupRelationshipGalaxyOptions = {}
): GroupRelationshipGalaxyData {
  const limits = normalizeLimits(options)
  const allMembers = getNonSystemMembersForContacts(db)
  const memberById = new Map(allMembers.map((member) => [member.id, member]))
  const messageRows = queryRelationshipMessages(db, filter).filter((message) => memberById.has(message.senderId))
  const activeMembers = buildActiveMembers(allMembers, messageRows)
  const activeMemberById = new Map(activeMembers.map((member) => [member.id, member]))

  if (activeMembers.length < 2) {
    return emptyResult(allMembers.length, activeMembers.length)
  }

  const edgeByPair = new Map<string, EdgeAccumulator>()
  for (const pair of accumulateCoOccurrencePairs(messageRows)) {
    if (!activeMemberById.has(pair.sourceId) || !activeMemberById.has(pair.targetId)) continue
    const edge = ensureEdge(edgeByPair, activeMemberById, pair.sourceId, pair.targetId)
    edge.coOccurrenceCount += pair.coOccurrenceCount
    edge.coOccurrenceRawScore += pair.rawScore
    edge.lastInteractionTs = maxTimestamp(edge.lastInteractionTs, pair.lastOccurrenceTs)
  }

  accumulateReplies(db, filter, activeMemberById, edgeByPair)
  accumulateMentions(db, filter, activeMembers, activeMemberById, edgeByPair)

  const weightedEdges = [...edgeByPair.values()]
    .map((edge) => ({ ...edge, weight: roundNum(computeEdgeWeight(edge)) }))
    .filter((edge) => edge.weight >= MIN_EDGE_WEIGHT)
    .sort(compareEdges)

  if (weightedEdges.length === 0) {
    return emptyResult(allMembers.length, activeMembers.length)
  }

  const candidateNodeKeys = selectCandidateNodeKeys(weightedEdges, limits.nodeLimit)
  const candidateEdges = weightedEdges.filter(
    (edge) => candidateNodeKeys.has(edge.sourceKey) && candidateNodeKeys.has(edge.targetKey)
  )
  const keptEdges = selectEdges(candidateEdges, limits.perNodeEdgeLimit, limits.edgeLimit)
  const displayedNodeKeys = new Set<string>()
  for (const edge of keptEdges) {
    displayedNodeKeys.add(edge.sourceKey)
    displayedNodeKeys.add(edge.targetKey)
  }

  const displayedMembers = activeMembers.filter((member) => displayedNodeKeys.has(member.key))
  const degreeByKey = computeDegreeByKey(keptEdges)
  const rankedMembers = [...displayedMembers].sort((a, b) => {
    const degreeDiff = (degreeByKey.get(b.key) ?? 0) - (degreeByKey.get(a.key) ?? 0)
    return degreeDiff || b.messageCount - a.messageCount || a.key.localeCompare(b.key)
  })
  const communityAssignments = detectWeightedCommunities(rankedMembers, keptEdges, degreeByKey)
  const communityByNodeKey = new Map<string, CommunityAssignment>()
  for (const community of communityAssignments) {
    for (const nodeKey of community.nodeKeys) communityByNodeKey.set(nodeKey, community)
  }

  const maxDegree = Math.max(...degreeByKey.values(), 1)
  const renderNodes: RelationshipGalaxyRenderNode[] = []
  const memberDetails: GroupRelationshipGalaxyMemberDetail[] = []
  const incidentTotals = buildIncidentTotals(keptEdges)

  for (const [index, member] of rankedMembers.entries()) {
    const degree = degreeByKey.get(member.key) ?? 0
    const score = degree / maxDegree
    const community = communityByNodeKey.get(member.key)!
    const position = layoutNode(member.key, index, community, rankedMembers, communityByNodeKey)
    const totals = incidentTotals.get(member.key) ?? createIncidentTotals()
    const rank = index + 1

    renderNodes.push({
      key: member.key,
      displayName: member.displayName,
      avatar: member.avatar,
      score: roundNum(score),
      rank,
      communityId: community.id,
      x: position.x,
      y: position.y,
      size: roundNum(18 + Math.sqrt(score) * 30, 2),
      color: community.color,
      labelVisibility: rank <= 8 ? 2 : rank <= 30 ? 1 : 0,
    })
    memberDetails.push({
      key: member.key,
      memberId: member.id,
      platformId: member.platformId,
      displayName: member.displayName,
      avatar: member.avatar,
      messageCount: member.messageCount,
      lastMessageTs: member.lastMessageTs,
      relationshipScore: roundNum(score),
      rank,
      communityId: community.id,
      replyInteractionCount: totals.replyInteractionCount,
      mentionInteractionCount: totals.mentionInteractionCount,
      coOccurrenceCount: totals.coOccurrenceCount,
      coOccurrenceRawScore: roundNum(totals.coOccurrenceRawScore),
      lastInteractionTs: totals.lastInteractionTs,
    })
  }

  const maxEdgeWeight = Math.max(...keptEdges.map((edge) => edge.weight), 1)
  const renderEdges: RelationshipGalaxyRenderEdge[] = keptEdges.map((edge) => ({
    id: edge.id,
    sourceKey: edge.sourceKey,
    targetKey: edge.targetKey,
    weight: edge.weight,
    visibility: edge.weight / maxEdgeWeight >= 0.35 ? 2 : 1,
  }))
  const edgeDetails: GroupRelationshipGalaxyEdgeDetail[] = keptEdges.map((edge) => ({
    id: edge.id,
    sourceKey: edge.sourceKey,
    targetKey: edge.targetKey,
    weight: edge.weight,
    coOccurrenceCount: edge.coOccurrenceCount,
    coOccurrenceRawScore: roundNum(edge.coOccurrenceRawScore),
    replyInteractionCount: edge.replyInteractionCount,
    mentionInteractionCount: edge.mentionInteractionCount,
    lastInteractionTs: edge.lastInteractionTs,
  }))
  const renderCommunities: RelationshipGalaxyRenderCommunity[] = communityAssignments.map((community, index) => ({
    id: community.id,
    label: `community-${index + 1}`,
    size: community.nodeKeys.length,
    x: community.x,
    y: community.y,
    color: community.color,
  }))

  return {
    graph: { nodes: renderNodes, edges: renderEdges, communities: renderCommunities },
    members: memberDetails,
    edges: edgeDetails,
    stats: {
      totalMembers: allMembers.length,
      activeMembers: activeMembers.length,
      displayedMembers: renderNodes.length,
      displayedEdges: renderEdges.length,
      communityCount: renderCommunities.length,
    },
    algorithmVersion: GROUP_RELATIONSHIP_GALAXY_ALGORITHM_VERSION,
  }
}

function queryRelationshipMessages(db: DatabaseAdapter, filter?: TimeFilter): Array<{ senderId: number; ts: number }> {
  const { clause, params } = buildTimeFilter(filter, 'msg')
  const where = appendConditions(clause, ['msg.type NOT IN (80, 81)'])
  return db
    .prepare(`SELECT msg.sender_id as senderId, msg.ts FROM message msg ${where} ORDER BY msg.ts ASC, msg.id ASC`)
    .all(...params) as Array<{ senderId: number; ts: number }>
}

function buildActiveMembers(
  allMembers: ContactMemberRef[],
  messages: Array<{ senderId: number; ts: number }>
): ActiveMember[] {
  const messageStats = new Map<number, { count: number; lastTs: number }>()
  for (const message of messages) {
    const stats = messageStats.get(message.senderId) ?? { count: 0, lastTs: 0 }
    stats.count++
    stats.lastTs = Math.max(stats.lastTs, message.ts)
    messageStats.set(message.senderId, stats)
  }

  const active = allMembers
    .filter((member) => messageStats.has(member.id))
    .map((member) => ({
      ...member,
      key: memberKey(member.id),
      displayName: member.name,
      messageCount: messageStats.get(member.id)!.count,
      lastMessageTs: messageStats.get(member.id)!.lastTs || null,
    }))

  const nameCounts = new Map<string, number>()
  for (const member of active) nameCounts.set(member.displayName, (nameCounts.get(member.displayName) ?? 0) + 1)
  for (const member of active) {
    if ((nameCounts.get(member.displayName) ?? 0) > 1) {
      member.displayName = `${member.displayName}#${member.platformId.slice(-4)}`
    }
  }
  return active
}

function accumulateReplies(
  db: DatabaseAdapter,
  filter: TimeFilter | undefined,
  activeMemberById: Map<number, ActiveMember>,
  edgeByPair: Map<string, EdgeAccumulator>
): void {
  if (!hasColumn(db, 'message', 'reply_to_message_id') || !hasColumn(db, 'message', 'platform_message_id')) return

  const { clause, params } = buildTimeFilter(filter, 'msg')
  const conditions = ['msg.type NOT IN (80, 81)', 'target.type NOT IN (80, 81)', 'msg.reply_to_message_id IS NOT NULL']
  const targetParams: number[] = []
  if (filter?.startTs !== undefined) {
    conditions.push('target.ts >= ?')
    targetParams.push(filter.startTs)
  }
  if (filter?.endTs !== undefined) {
    conditions.push('target.ts <= ?')
    targetParams.push(filter.endTs)
  }
  const rows = db
    .prepare(
      `SELECT msg.sender_id as replySenderId, msg.ts as replyTs, target.sender_id as targetSenderId
       FROM message msg
       JOIN message target ON msg.reply_to_message_id = target.platform_message_id
       ${appendConditions(clause, conditions)}`
    )
    .all(...params, ...targetParams) as Array<{ replySenderId: number; replyTs: number; targetSenderId: number }>

  for (const row of rows) {
    if (row.replySenderId === row.targetSenderId) continue
    if (!activeMemberById.has(row.replySenderId) || !activeMemberById.has(row.targetSenderId)) continue
    const edge = ensureEdge(edgeByPair, activeMemberById, row.replySenderId, row.targetSenderId)
    edge.replyInteractionCount++
    edge.lastInteractionTs = maxTimestamp(edge.lastInteractionTs, row.replyTs)
  }
}

function accumulateMentions(
  db: DatabaseAdapter,
  filter: TimeFilter | undefined,
  activeMembers: ActiveMember[],
  activeMemberById: Map<number, ActiveMember>,
  edgeByPair: Map<string, EdgeAccumulator>
): void {
  const nameToMemberId = buildMentionNameIndex(db, activeMembers)
  const { clause, params } = buildTimeFilter(filter, 'msg')
  const where = appendConditions(clause, ['msg.type = 0', 'msg.content IS NOT NULL', "msg.content LIKE '%@%'"])
  const rows = db
    .prepare(`SELECT msg.sender_id as senderId, msg.ts, msg.content FROM message msg ${where}`)
    .all(...params) as Array<{ senderId: number; ts: number; content: string }>
  const mentionRegex = /@([^\s@]+)/g

  for (const row of rows) {
    if (!activeMemberById.has(row.senderId)) continue
    const mentionedInMessage = new Set<number>()
    for (const match of row.content.matchAll(mentionRegex)) {
      const mentionedId = nameToMemberId.get(match[1])
      if (mentionedId === null || mentionedId === undefined || mentionedId === row.senderId) continue
      if (!activeMemberById.has(mentionedId) || mentionedInMessage.has(mentionedId)) continue
      mentionedInMessage.add(mentionedId)
      const edge = ensureEdge(edgeByPair, activeMemberById, row.senderId, mentionedId)
      edge.mentionInteractionCount++
      edge.lastInteractionTs = maxTimestamp(edge.lastInteractionTs, row.ts)
    }
  }
}

function buildMentionNameIndex(db: DatabaseAdapter, members: ActiveMember[]): Map<string, number | null> {
  const index = new Map<string, number | null>()
  const addName = (name: string, memberId: number) => {
    const trimmed = name.trim()
    if (!trimmed) return
    const existing = index.get(trimmed)
    if (existing === undefined || existing === memberId) index.set(trimmed, memberId)
    else index.set(trimmed, null)
  }

  for (const member of members) {
    addName(member.name, member.id)
    for (const alias of member.aliases) addName(alias, member.id)
  }

  if (hasTable(db, 'member_name_history')) {
    const memberIds = new Set(members.map((member) => member.id))
    const rows = db.prepare('SELECT member_id as memberId, name FROM member_name_history').all() as Array<{
      memberId: number
      name: string
    }>
    for (const row of rows) {
      if (memberIds.has(row.memberId)) addName(row.name, row.memberId)
    }
  }
  return index
}

function ensureEdge(
  edgeByPair: Map<string, EdgeAccumulator>,
  memberById: Map<number, ActiveMember>,
  aId: number,
  bId: number
): EdgeAccumulator {
  const sourceId = Math.min(aId, bId)
  const targetId = Math.max(aId, bId)
  const id = `${memberKey(sourceId)}--${memberKey(targetId)}`
  const existing = edgeByPair.get(id)
  if (existing) return existing
  const created: EdgeAccumulator = {
    id,
    sourceId,
    targetId,
    sourceKey: memberById.get(sourceId)!.key,
    targetKey: memberById.get(targetId)!.key,
    coOccurrenceCount: 0,
    coOccurrenceRawScore: 0,
    replyInteractionCount: 0,
    mentionInteractionCount: 0,
    lastInteractionTs: null,
    weight: 0,
  }
  edgeByPair.set(id, created)
  return created
}

function computeEdgeWeight(edge: EdgeAccumulator): number {
  return (
    edge.coOccurrenceRawScore +
    edge.replyInteractionCount * REPLY_WEIGHT +
    edge.mentionInteractionCount * MENTION_WEIGHT +
    edge.coOccurrenceCount * CO_OCCURRENCE_COUNT_WEIGHT
  )
}

function selectCandidateNodeKeys(edges: EdgeAccumulator[], nodeLimit: number): Set<string> {
  const degree = computeDegreeByKey(edges)
  return new Set(
    [...degree.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, nodeLimit)
      .map(([key]) => key)
  )
}

function selectEdges(edges: EdgeAccumulator[], perNodeLimit: number, edgeLimit: number): EdgeAccumulator[] {
  const incident = new Map<string, EdgeAccumulator[]>()
  for (const edge of edges) {
    for (const key of [edge.sourceKey, edge.targetKey]) {
      const list = incident.get(key) ?? []
      list.push(edge)
      incident.set(key, list)
    }
  }
  const selectedIds = new Set<string>()
  for (const list of incident.values()) {
    list.sort(compareEdges)
    for (const edge of list.slice(0, perNodeLimit)) selectedIds.add(edge.id)
  }
  return edges
    .filter((edge) => selectedIds.has(edge.id))
    .sort(compareEdges)
    .slice(0, edgeLimit)
}

function computeDegreeByKey(edges: EdgeAccumulator[]): Map<string, number> {
  const degree = new Map<string, number>()
  for (const edge of edges) {
    degree.set(edge.sourceKey, (degree.get(edge.sourceKey) ?? 0) + edge.weight)
    degree.set(edge.targetKey, (degree.get(edge.targetKey) ?? 0) + edge.weight)
  }
  return degree
}

function detectWeightedCommunities(
  members: ActiveMember[],
  edges: EdgeAccumulator[],
  degreeByKey: Map<string, number>
): CommunityAssignment[] {
  const parent = new Map<string, string>(members.map((member) => [member.key, member.key]))
  const strongestByKey = new Map<string, number>()
  for (const edge of edges) {
    strongestByKey.set(edge.sourceKey, Math.max(strongestByKey.get(edge.sourceKey) ?? 0, edge.weight))
    strongestByKey.set(edge.targetKey, Math.max(strongestByKey.get(edge.targetKey) ?? 0, edge.weight))
  }

  const find = (key: string): string => {
    const current = parent.get(key) ?? key
    if (current === key) return current
    const root = find(current)
    parent.set(key, root)
    return root
  }
  const union = (a: string, b: string) => {
    const aRoot = find(a)
    const bRoot = find(b)
    if (aRoot === bRoot) return
    const [source, target] = aRoot.localeCompare(bRoot) <= 0 ? [aRoot, bRoot] : [bRoot, aRoot]
    parent.set(target, source)
  }

  for (const edge of edges) {
    const sourceThreshold = (strongestByKey.get(edge.sourceKey) ?? edge.weight) * 0.6
    const targetThreshold = (strongestByKey.get(edge.targetKey) ?? edge.weight) * 0.6
    if (edge.weight >= sourceThreshold && edge.weight >= targetThreshold) union(edge.sourceKey, edge.targetKey)
  }

  const groups = new Map<string, string[]>()
  for (const member of members) {
    const root = find(member.key)
    const list = groups.get(root) ?? []
    list.push(member.key)
    groups.set(root, list)
  }
  const sortedGroups = [...groups.values()]
    .map((keys) => keys.sort())
    .sort((a, b) => {
      const aWeight = a.reduce((sum, key) => sum + (degreeByKey.get(key) ?? 0), 0)
      const bWeight = b.reduce((sum, key) => sum + (degreeByKey.get(key) ?? 0), 0)
      return bWeight - aWeight || a[0].localeCompare(b[0])
    })

  return sortedGroups.map((nodeKeys, index) => {
    const center = layoutCommunity(index, sortedGroups.length)
    return {
      id: `community:${nodeKeys[0]}`,
      nodeKeys,
      color: COMMUNITY_COLORS[stableHash(nodeKeys[0]) % COMMUNITY_COLORS.length],
      x: center.x,
      y: center.y,
    }
  })
}

function layoutCommunity(index: number, count: number): { x: number; y: number } {
  if (index === 0 || count === 1) return { x: 0, y: 0 }
  const ringIndex = index - 1
  const ring = Math.floor(ringIndex / 6)
  const position = ringIndex % 6
  const radius = 380 + ring * 280
  const angle = -Math.PI / 2 + (position / 6) * Math.PI * 2 + ring * 0.31
  return { x: roundNum(Math.cos(angle) * radius, 2), y: roundNum(Math.sin(angle) * radius, 2) }
}

function layoutNode(
  nodeKey: string,
  globalIndex: number,
  community: CommunityAssignment,
  members: ActiveMember[],
  communityByNodeKey: Map<string, CommunityAssignment>
): { x: number; y: number } {
  const communityMembers = members.filter((member) => communityByNodeKey.get(member.key)?.id === community.id)
  const localIndex = communityMembers.findIndex((member) => member.key === nodeKey)
  const angle = localIndex * 2.399963229728653 + (stableHash(nodeKey) % 1000) / 1000
  const radius = localIndex === 0 ? 0 : 54 + Math.sqrt(localIndex) * 42
  const globalJitter = (globalIndex % 3) * 2
  return {
    x: roundNum(community.x + Math.cos(angle) * (radius + globalJitter), 2),
    y: roundNum(community.y + Math.sin(angle) * (radius + globalJitter), 2),
  }
}

function buildIncidentTotals(edges: EdgeAccumulator[]) {
  const totals = new Map<string, ReturnType<typeof createIncidentTotals>>()
  for (const edge of edges) {
    for (const key of [edge.sourceKey, edge.targetKey]) {
      const item = totals.get(key) ?? createIncidentTotals()
      item.replyInteractionCount += edge.replyInteractionCount
      item.mentionInteractionCount += edge.mentionInteractionCount
      item.coOccurrenceCount += edge.coOccurrenceCount
      item.coOccurrenceRawScore += edge.coOccurrenceRawScore
      item.lastInteractionTs = maxTimestamp(item.lastInteractionTs, edge.lastInteractionTs)
      totals.set(key, item)
    }
  }
  return totals
}

function createIncidentTotals() {
  return {
    replyInteractionCount: 0,
    mentionInteractionCount: 0,
    coOccurrenceCount: 0,
    coOccurrenceRawScore: 0,
    lastInteractionTs: null as number | null,
  }
}

function normalizeLimits(options: GroupRelationshipGalaxyOptions) {
  return {
    nodeLimit: normalizeLimit(options.nodeLimit, DEFAULT_LIMITS.nodeLimit),
    edgeLimit: normalizeLimit(options.edgeLimit, DEFAULT_LIMITS.edgeLimit),
    perNodeEdgeLimit: normalizeLimit(options.perNodeEdgeLimit, DEFAULT_LIMITS.perNodeEdgeLimit),
  }
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

function appendConditions(clause: string, conditions: string[]): string {
  const existing = clause.trim().replace(/^WHERE\s+/i, '')
  return `WHERE ${[existing, ...conditions].filter(Boolean).join(' AND ')}`
}

function emptyResult(totalMembers: number, activeMembers: number): GroupRelationshipGalaxyData {
  return {
    graph: { nodes: [], edges: [], communities: [] },
    members: [],
    edges: [],
    stats: { totalMembers, activeMembers, displayedMembers: 0, displayedEdges: 0, communityCount: 0 },
    algorithmVersion: GROUP_RELATIONSHIP_GALAXY_ALGORITHM_VERSION,
  }
}

function compareEdges(a: EdgeAccumulator, b: EdgeAccumulator): number {
  return b.weight - a.weight || a.id.localeCompare(b.id)
}

function memberKey(memberId: number): string {
  return `member:${memberId}`
}

function maxTimestamp(current: number | null, next: number | null): number | null {
  if (next === null) return current
  return Math.max(current ?? 0, next) || null
}

function roundNum(value: number, digits = 4): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function stableHash(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}
