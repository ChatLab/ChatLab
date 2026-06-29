import {
  ChatType,
  type ChatPlatform,
  type ContactsTimeRangePreset,
  type ContactsTimeRangeState,
  type PeopleRelationshipCommunity,
  type PeopleRelationshipsGraphData,
  type PeopleRelationshipGraphEdge,
  type PeopleRelationshipGraphNode,
  type PeopleRelationshipsDiagnostics,
} from '@openchatlab/shared-types'
import {
  computeFriendScores,
  computeNonFriendScores,
  getGroupContactFacts,
  getGroupRelationshipGraphFacts,
  getLatestContactMessageTs,
  getPrivateContactFacts,
  getSessionMeta,
  isChatSessionDb,
  isNameMatchPlatform,
  resolveOwnerMember,
} from '@openchatlab/core'
import type { ContactMemberRef, SessionMeta } from '@openchatlab/core'
import { getDbFileVersion } from '../../../cache/analytics-cache'
import { appLogger } from '../../../logging/app-logger'
import type { SessionRuntimeAdapter } from '../../adapters'
import {
  buildPeopleRelationshipsSessionFactsCacheKey,
  buildPeopleRelationshipsSessionLatestCacheKey,
  createEmptyPeopleRelationshipsFactsCacheStats,
  readCachedPeopleRelationshipsSessionFacts,
  readCachedPeopleRelationshipsSessionLatest,
  writeCachedPeopleRelationshipsSessionFacts,
  writeCachedPeopleRelationshipsSessionLatest,
  type PeopleRelationshipsCachedGroupFacts,
  type PeopleRelationshipsCachedPrivateFacts,
  type PeopleRelationshipsFactsCacheStats,
  type PeopleRelationshipsSessionFacts,
  type PeopleRelationshipsSessionLatestFacts,
  type PeopleRelationshipsSessionMetaFacts,
} from './facts-cache'
import { resolvePeopleRelationshipsTimeRange } from './time-range'

export const PEOPLE_RELATIONSHIPS_ALGORITHM_VERSION = 'people-relationships-v2'

const PRIVATE_COMMUNITY_ID = 'private'
const OWNER_KEY_PREFIX = 'owner'
const REPLY_WEIGHT = 3
const CO_OCCURRENCE_COUNT_WEIGHT = 0.05
const EDGE_RECENCY_HALF_LIFE_SECONDS = 120 * 24 * 60 * 60
const EDGE_RECENCY_FLOOR = 0.1
const MIN_GROUP_FRIENDS_FOR_PANORAMA = 3
const MIN_GROUP_FRIEND_RATIO_FOR_PANORAMA = 0.2
const MIN_OWNER_CONNECTED_MEMBERS_FOR_PANORAMA = 3
const MIN_OWNER_GROUP_MESSAGES_FOR_PANORAMA = 20
const MIN_OWNER_GROUP_MESSAGE_RATIO_FOR_PANORAMA = 0.05
const MIN_OWNER_GROUP_MESSAGES_FOR_RATIO = 8
const SMALL_GROUP_MEMBER_LIMIT_FOR_FRIEND_EDGE = 12
const MAX_OWNER_CONNECTED_NON_FRIENDS_PER_GROUP = 30
const MAX_FRIEND_CONNECTED_NON_FRIENDS_PER_GROUP = 30
const MAX_HIGH_SIGNAL_NON_FRIENDS_PER_GROUP = 10
const MAX_MEMBERS_PER_GROUP_FOR_PANORAMA = 80

const COMMUNITY_COLORS = [
  '#7dd3fc',
  '#f0abfc',
  '#facc15',
  '#34d399',
  '#fb7185',
  '#a78bfa',
  '#2dd4bf',
  '#f97316',
  '#60a5fa',
  '#e879f9',
]

export interface PeopleRelationshipsWorkerStats {
  durationMs: number
  totalSessions: number
  processedSessions: number
  skippedFailedSessions: number
}

export interface PeopleRelationshipsComputeLimits {
  coreNodeLimit?: number
  coreEdgeLimit?: number
  perNodeEdgeLimit?: number
  neighborhoodNodeLimit?: number
  neighborhoodEdgeLimit?: number
  searchResultLimit?: number
}

export interface PeopleRelationshipsSnapshot {
  nodes: PeopleRelationshipGraphNode[]
  edges: PeopleRelationshipGraphEdge[]
  communities: PeopleRelationshipCommunity[]
  graph: PeopleRelationshipsGraphData
  diagnostics: PeopleRelationshipsDiagnostics
  algorithmVersion: string
  signature: string
  timeRange: ContactsTimeRangeState
  computedAt: number
  workerStats: PeopleRelationshipsWorkerStats
  limits: Required<PeopleRelationshipsComputeLimits>
}

export interface PeopleRelationshipsComputeProgress {
  processedSessions: number
  totalSessions: number
  currentSessionId?: string
}

export interface ComputePeopleRelationshipsSnapshotOptions {
  adapter: SessionRuntimeAdapter
  signature: string
  timeRangePreset?: ContactsTimeRangePreset
  factsCacheDir?: string
  limits?: PeopleRelationshipsComputeLimits
  now?: () => number
  onProgress?: (progress: PeopleRelationshipsComputeProgress) => void
}

interface NodeAccumulator {
  key: string
  kind: 'contact' | 'owner'
  platform: ChatPlatform
  platformId: string
  sessionScoped: boolean
  sessionId?: string
  displayName: string
  aliases: Set<string>
  avatar: string | null
  isFriend: boolean
  friendSource?: 'private'
  privateMessageCount: number
  activePrivateMonths: Set<string>
  groupMessageCount: number
  commonGroupSessionIds: Set<string>
  ownerCoOccurrenceCount: number
  ownerCoOccurrenceRawScore: number
  ownerReplyInteractionCount: number
  ownerRepliesFromOwnerToContact: number
  ownerRepliesFromContactToOwner: number
  communityWeights: Map<string, number>
  edgeWeight: number
  panoramaCandidate: boolean
  lastInteractionTs: number | null
}

interface EdgeAccumulator {
  sourceKey: string
  targetKey: string
  coOccurrenceCount: number
  coOccurrenceRawScore: number
  replyInteractionCount: number
  repliesFromSourceToTarget: number
  repliesFromTargetToSource: number
  sourceSessionIds: Set<string>
  panoramaEligible: boolean
  lastInteractionTs: number | null
}

interface GroupPanoramaContribution {
  sessionId: string
  memberKeys: Set<string>
  memberMessageCounts: Map<string, number>
  ownerConnectedKeys: Set<string>
  ownerEdgeScores: Map<string, number>
  relationshipEdgeIds: Set<string>
  relationshipEdgeEndpoints: Map<string, [string, string]>
  relationshipEdgeScores: Map<string, number>
  friendConnectedScores: Map<string, number>
  ownerMessageCount: number
}

interface BuildGraphResult {
  nodes: PeopleRelationshipGraphNode[]
  edges: PeopleRelationshipGraphEdge[]
  communities: PeopleRelationshipCommunity[]
  graph: PeopleRelationshipsGraphData
  diagnostics: PeopleRelationshipsDiagnostics
}

interface PeopleRelationshipsFactsCacheContext {
  dir: string
  latestKey: string
  stats: PeopleRelationshipsFactsCacheStats
}

export function computePeopleRelationshipsSnapshot(
  options: ComputePeopleRelationshipsSnapshotOptions
): PeopleRelationshipsSnapshot {
  const startedAt = options.now?.() ?? Date.now()
  const sessionIds = options.adapter.listSessionIds()
  const limits = normalizeLimits(options.limits)
  const factsCache = options.factsCacheDir ? createFactsCacheContext(options.factsCacheDir) : null
  const timeRange = resolvePeopleRelationshipsTimeRange(
    options.timeRangePreset,
    findGlobalLatestMessageTs(options.adapter, sessionIds, factsCache)
  )
  const result = computePeopleRelationships({
    adapter: options.adapter,
    sessionIds,
    timeRange,
    factsCache,
    limits,
    onProgress: options.onProgress,
  })
  const finishedAt = options.now?.() ?? Date.now()
  if (factsCache) {
    appLogger.info('people-relationships', 'people relationships session facts cache summary', factsCache.stats)
  }
  appLogger.info('people-relationships', 'people relationships panorama filter summary', {
    includedGroupSessions: result.diagnostics.panoramaIncludedGroupSessions,
    excludedLowValueGroupSessions: result.diagnostics.panoramaExcludedLowValueGroupSessions,
    includedGroupMembers: result.diagnostics.panoramaIncludedGroupMembers,
    excludedGroupMembers: result.diagnostics.panoramaExcludedGroupMembers,
    candidateNodes: result.diagnostics.panoramaCandidateNodes,
    reasons: result.diagnostics.panoramaGroupInclusionReasons,
  })
  return {
    ...result,
    algorithmVersion: PEOPLE_RELATIONSHIPS_ALGORITHM_VERSION,
    signature: options.signature,
    timeRange,
    computedAt: finishedAt,
    limits,
    workerStats: {
      durationMs: Math.max(0, finishedAt - startedAt),
      totalSessions: sessionIds.length,
      processedSessions: sessionIds.length,
      skippedFailedSessions: result.diagnostics.skippedFailedSessions,
    },
  }
}

export function buildPeopleRelationshipsNeighborhoodGraph(
  snapshot: PeopleRelationshipsSnapshot,
  contactKey: string,
  limits: PeopleRelationshipsComputeLimits = {}
): PeopleRelationshipsGraphData {
  const normalizedLimits = normalizeLimits({ ...snapshot.limits, ...limits })
  const center = snapshot.nodes.find((node) => node.key === contactKey)
  if (!center) return { nodes: [], edges: [], communities: [] }

  const relatedEdges = sortEdgesForDisplay(
    snapshot.edges.filter((edge) => edge.sourceKey === contactKey || edge.targetKey === contactKey)
  )
  const { directEdges, nodeKeys } = selectNeighborhoodDirectEdges(relatedEdges, contactKey, normalizedLimits)

  const directEdgeIds = new Set(relatedEdges.map((edge) => edge.id))
  const secondaryEdgeLimit = Math.max(0, normalizedLimits.neighborhoodEdgeLimit - directEdges.length)
  const secondaryEdges = sortEdgesForDisplay(
    snapshot.edges.filter(
      (edge) => !directEdgeIds.has(edge.id) && nodeKeys.has(edge.sourceKey) && nodeKeys.has(edge.targetKey)
    )
  ).slice(0, secondaryEdgeLimit)
  const edges = sortEdgesForDisplay([...directEdges, ...secondaryEdges])
  const nodes = layoutNeighborhoodNodes(
    snapshot.nodes.filter((node) => nodeKeys.has(node.key)),
    directEdges,
    contactKey
  ).sort(compareNodes)
  return {
    nodes,
    edges,
    communities: filterNeighborhoodCommunities(snapshot.communities, directEdges),
  }
}

function selectNeighborhoodDirectEdges(
  relatedEdges: PeopleRelationshipGraphEdge[],
  contactKey: string,
  limits: Required<PeopleRelationshipsComputeLimits>
): { directEdges: PeopleRelationshipGraphEdge[]; nodeKeys: Set<string> } {
  // 邻域图先按直接关系排序选择节点，避免高连接节点绕过节点/边上限。
  const nodeKeys = new Set<string>([contactKey])
  const directEdges: PeopleRelationshipGraphEdge[] = []

  for (const edge of relatedEdges) {
    if (directEdges.length >= limits.neighborhoodEdgeLimit) break
    const neighborKey = getNeighborhoodNeighborKey(edge, contactKey)
    if (!neighborKey) continue
    if (!nodeKeys.has(neighborKey)) {
      if (nodeKeys.size >= limits.neighborhoodNodeLimit) continue
      nodeKeys.add(neighborKey)
    }
    directEdges.push(edge)
  }

  return { directEdges, nodeKeys }
}

function getNeighborhoodNeighborKey(edge: PeopleRelationshipGraphEdge, contactKey: string): string | null {
  if (edge.sourceKey === contactKey) return edge.targetKey
  if (edge.targetKey === contactKey) return edge.sourceKey
  return null
}

function layoutNeighborhoodNodes(
  nodes: PeopleRelationshipGraphNode[],
  relatedEdges: PeopleRelationshipGraphEdge[],
  contactKey: string
): PeopleRelationshipGraphNode[] {
  const center = nodes.find((node) => node.key === contactKey)
  if (!center) return nodes.map((node) => ({ ...node }))

  const directEdgeByNodeKey = new Map<string, PeopleRelationshipGraphEdge>()
  for (const edge of relatedEdges) {
    const neighborKey =
      edge.sourceKey === contactKey ? edge.targetKey : edge.targetKey === contactKey ? edge.sourceKey : null
    if (neighborKey) directEdgeByNodeKey.set(neighborKey, edge)
  }
  const maxDirectWeight = Math.max(...[...directEdgeByNodeKey.values()].map((edge) => edge.weight), 1)
  const communityGroups = new Map<string, PeopleRelationshipGraphNode[]>()
  for (const node of nodes) {
    if (node.key === contactKey) continue
    const group = communityGroups.get(node.communityId) ?? []
    group.push(node)
    communityGroups.set(node.communityId, group)
  }

  const sortedCommunityGroups = [...communityGroups.entries()].sort((a, b) => {
    if (a[0] === center.communityId) return -1
    if (b[0] === center.communityId) return 1
    const weightA = sumNeighborhoodCommunityWeight(a[1], directEdgeByNodeKey)
    const weightB = sumNeighborhoodCommunityWeight(b[1], directEdgeByNodeKey)
    return weightB - weightA || a[0].localeCompare(b[0])
  })

  const localNodes: PeopleRelationshipGraphNode[] = [{ ...center, x: 0, y: 0 }]
  for (const [communityIndex, [communityId, communityNodes]] of sortedCommunityGroups.entries()) {
    const baseAngle = neighborhoodCommunityAngle(communityIndex, communityId, center.communityId)
    communityNodes.sort((a, b) => {
      const edgeA = directEdgeByNodeKey.get(a.key)?.weight ?? 0
      const edgeB = directEdgeByNodeKey.get(b.key)?.weight ?? 0
      return edgeB - edgeA || compareNodes(a, b)
    })

    for (const [index, node] of communityNodes.entries()) {
      const angle = neighborhoodNodeAngle(baseAngle, communityId, node.key, index, communityNodes.length)
      const radius = neighborhoodNodeRadius(
        node,
        center,
        directEdgeByNodeKey.get(node.key),
        maxDirectWeight,
        communityNodes.length
      )
      localNodes.push({
        ...node,
        x: roundNum(Math.cos(angle) * radius, 2),
        y: roundNum(Math.sin(angle) * radius, 2),
      })
    }
  }
  return localNodes
}

function sumNeighborhoodCommunityWeight(
  nodes: PeopleRelationshipGraphNode[],
  directEdgeByNodeKey: Map<string, PeopleRelationshipGraphEdge>
): number {
  return nodes.reduce((sum, node) => sum + (directEdgeByNodeKey.get(node.key)?.weight ?? 0), 0)
}

function neighborhoodCommunityAngle(index: number, communityId: string, centerCommunityId: string): number {
  if (communityId === centerCommunityId) return -Math.PI / 2
  return index * 2.399963229728653
}

function neighborhoodNodeAngle(
  baseAngle: number,
  communityId: string,
  nodeKey: string,
  index: number,
  communitySize: number
): number {
  const seedOffset = ((stableHash(`${communityId}:${nodeKey}:neighborhood-angle`) % 1000) / 1000 - 0.5) * 0.12
  const centeredIndex = index - (communitySize - 1) / 2
  const spacing = communitySize <= 4 ? 0.42 : communitySize <= 10 ? 0.24 : 0.14
  const maxSpread = communitySize <= 4 ? 0.72 : communitySize <= 20 ? 1.08 : 1.32
  return baseAngle + clamp(centeredIndex * spacing + seedOffset, -maxSpread, maxSpread)
}

function neighborhoodNodeRadius(
  node: PeopleRelationshipGraphNode,
  center: PeopleRelationshipGraphNode,
  directEdge: PeopleRelationshipGraphEdge | undefined,
  maxDirectWeight: number,
  communitySize: number
): number {
  const directStrength = directEdge ? Math.min(1, directEdge.weight / maxDirectWeight) : 0
  const sameCommunityBonus = node.communityId === center.communityId ? 110 : 0
  const smallCommunityBonus = node.communityId === center.communityId && communitySize <= 6 ? 80 : 0
  const friendBonus = node.pool === 'friend' ? 70 : 0
  const scoreBonus = Math.min(90, Math.sqrt(Math.max(0, Math.min(1, node.score))) * 90)
  const rankPenalty = Math.sqrt(Math.max(0, node.rank - center.rank)) * 8
  return roundNum(
    clamp(
      260 +
        (1 - directStrength) * 560 +
        rankPenalty -
        sameCommunityBonus -
        smallCommunityBonus -
        friendBonus -
        scoreBonus,
      120,
      1100
    ),
    2
  )
}

function computePeopleRelationships(options: {
  adapter: SessionRuntimeAdapter
  sessionIds: string[]
  timeRange: ContactsTimeRangeState
  factsCache: PeopleRelationshipsFactsCacheContext | null
  limits: Required<PeopleRelationshipsComputeLimits>
  onProgress?: (progress: PeopleRelationshipsComputeProgress) => void
}): BuildGraphResult {
  const diagnostics = createEmptyDiagnostics()
  const nodes = new Map<string, NodeAccumulator>()
  const edges = new Map<string, EdgeAccumulator>()
  const groupContributions: GroupPanoramaContribution[] = []
  const communityLabels = new Map<string, string>([[PRIVATE_COMMUNITY_ID, 'Private contacts']])
  let processedSessions = 0

  for (const sessionId of options.sessionIds) {
    options.onProgress?.({ processedSessions, totalSessions: options.sessionIds.length, currentSessionId: sessionId })
    try {
      const facts = getSessionFacts(options.adapter, sessionId, options.timeRange, options.factsCache)
      applySessionFacts(nodes, edges, groupContributions, communityLabels, diagnostics, sessionId, facts)
    } catch (error) {
      diagnostics.skippedFailedSessions++
      appLogger.error('people-relationships', `failed to process people relationship session: ${sessionId}`, error)
    } finally {
      processedSessions++
      options.onProgress?.({ processedSessions, totalSessions: options.sessionIds.length, currentSessionId: sessionId })
    }
  }

  applyPanoramaContributions([...nodes.values()], edges, groupContributions, diagnostics)
  return buildGraph(
    [...nodes.values()],
    [...edges.values()],
    communityLabels,
    groupContributions,
    options.limits,
    diagnostics
  )
}

function findGlobalLatestMessageTs(
  adapter: SessionRuntimeAdapter,
  sessionIds: string[],
  factsCache: PeopleRelationshipsFactsCacheContext | null
): number | null {
  let latest: number | null = null
  for (const sessionId of sessionIds) {
    const dbVersion = getSessionDbVersion(adapter, sessionId)
    const cached = readLatestFacts(sessionId, factsCache, dbVersion)
    if (cached) {
      if (cached.latestMessageTs !== null) latest = Math.max(latest ?? 0, cached.latestMessageTs)
      continue
    }
    try {
      const db = adapter.openReadonly(sessionId)
      const ts = db && isChatSessionDb(db) ? getLatestContactMessageTs(db) : null
      writeLatestFacts(adapter, sessionId, factsCache, { latestMessageTs: ts }, dbVersion)
      if (ts !== null) latest = Math.max(latest ?? 0, ts)
    } catch (error) {
      appLogger.error(
        'people-relationships',
        `failed to inspect people relationship session range: ${sessionId}`,
        error
      )
    }
  }
  return latest
}

function getSessionFacts(
  adapter: SessionRuntimeAdapter,
  sessionId: string,
  timeRange: ContactsTimeRangeState,
  factsCache: PeopleRelationshipsFactsCacheContext | null
): PeopleRelationshipsSessionFacts {
  const dbVersion = getSessionDbVersion(adapter, sessionId)
  const cached = readSessionFacts(sessionId, timeRange, factsCache, dbVersion)
  if (cached) return cached

  const facts = computeSessionFacts(adapter, sessionId, timeRange)
  writeSessionFacts(adapter, sessionId, timeRange, factsCache, facts, dbVersion)
  return facts
}

function computeSessionFacts(
  adapter: SessionRuntimeAdapter,
  sessionId: string,
  timeRange: ContactsTimeRangeState
): PeopleRelationshipsSessionFacts {
  const db = adapter.openReadonly(sessionId)
  if (!db || !isChatSessionDb(db)) return { kind: 'not_chat_db', latestMessageTs: null }

  const latestMessageTs = getLatestContactMessageTs(db)
  const meta = getSessionMeta(db)
  if (!meta) return { kind: 'missing_meta', latestMessageTs }
  if (meta.type !== ChatType.PRIVATE && meta.type !== ChatType.GROUP)
    return { kind: 'unsupported_type', latestMessageTs }

  const cachedMeta = toPeopleRelationshipsSessionMetaFacts(meta)
  if (!meta.ownerId?.trim()) return { kind: 'missing_owner', meta: cachedMeta, latestMessageTs }

  const owner = resolveOwnerMember(db)
  if (!owner) return { kind: 'unresolved_owner', meta: cachedMeta, latestMessageTs }
  const cachedMetaWithOwner = toPeopleRelationshipsSessionMetaFacts(meta, owner)

  if (meta.type === ChatType.PRIVATE) {
    const facts = getPrivateContactFacts(db, owner.id, { startTs: timeRange.startTs })
    if (facts.type === 'missing') return { kind: 'private_missing', meta: cachedMetaWithOwner, latestMessageTs }
    if (facts.type === 'ambiguous') return { kind: 'private_ambiguous', meta: cachedMetaWithOwner, latestMessageTs }
    return { kind: 'private', meta: cachedMetaWithOwner, latestMessageTs, facts }
  }

  return {
    kind: 'group',
    meta: cachedMetaWithOwner,
    latestMessageTs,
    facts: {
      ...getGroupRelationshipGraphFacts(db, owner.id, { startTs: timeRange.startTs }),
      ownerEdges: getGroupContactFacts(db, owner.id, { startTs: timeRange.startTs }),
    },
  }
}

function applySessionFacts(
  nodes: Map<string, NodeAccumulator>,
  edges: Map<string, EdgeAccumulator>,
  groupContributions: GroupPanoramaContribution[],
  communityLabels: Map<string, string>,
  diagnostics: PeopleRelationshipsDiagnostics,
  sessionId: string,
  sessionFacts: PeopleRelationshipsSessionFacts
): void {
  switch (sessionFacts.kind) {
    case 'missing_owner':
      diagnostics.skippedMissingOwnerSessions++
      return
    case 'unresolved_owner':
      diagnostics.skippedUnresolvedOwnerSessions++
      return
    case 'private_ambiguous':
      diagnostics.skippedAmbiguousPrivateSessions++
      return
    case 'private':
      diagnostics.processedPrivateSessions++
      applyPrivateFacts(nodes, edges, sessionId, sessionFacts.meta, sessionFacts.facts)
      return
    case 'group':
      diagnostics.processedGroupSessions++
      applyGroupFacts(
        nodes,
        edges,
        groupContributions,
        communityLabels,
        sessionId,
        sessionFacts.meta,
        sessionFacts.facts
      )
      return
    default:
      return
  }
}

function applyPrivateFacts(
  nodes: Map<string, NodeAccumulator>,
  edges: Map<string, EdgeAccumulator>,
  sessionId: string,
  meta: PeopleRelationshipsSessionMetaFacts,
  facts: PeopleRelationshipsCachedPrivateFacts
): void {
  if (facts.privateMessageCount <= 0) return
  const ownerNode = getOrCreateOwnerNode(nodes, meta)
  const node = getOrCreateNode(nodes, sessionId, meta, facts.contact)
  node.isFriend = true
  node.friendSource = 'private'
  node.panoramaCandidate = true
  node.privateMessageCount += facts.privateMessageCount
  for (const month of facts.activeMonths) node.activePrivateMonths.add(month)
  node.communityWeights.set(PRIVATE_COMMUNITY_ID, (node.communityWeights.get(PRIVATE_COMMUNITY_ID) ?? 0) + 1)
  updateLastInteraction(node, facts.lastMessageTs)

  if (!ownerNode) return
  ownerNode.isFriend = true
  ownerNode.panoramaCandidate = true
  ownerNode.privateMessageCount += facts.privateMessageCount
  for (const month of facts.activeMonths) ownerNode.activePrivateMonths.add(month)
  ownerNode.communityWeights.set(PRIVATE_COMMUNITY_ID, (ownerNode.communityWeights.get(PRIVATE_COMMUNITY_ID) ?? 0) + 1)
  updateLastInteraction(ownerNode, facts.lastMessageTs)
  applyOwnerContactEdge(edges, ownerNode, node, {
    coOccurrenceCount: facts.privateMessageCount,
    coOccurrenceRawScore: facts.privateMessageCount * 1.8,
    replyInteractionCount: 0,
    repliesFromOwnerToContact: 0,
    repliesFromContactToOwner: 0,
    lastInteractionTs: facts.lastMessageTs,
    sessionId,
    panoramaEligible: true,
  })
}

function applyGroupFacts(
  nodes: Map<string, NodeAccumulator>,
  edges: Map<string, EdgeAccumulator>,
  groupContributions: GroupPanoramaContribution[],
  communityLabels: Map<string, string>,
  sessionId: string,
  meta: PeopleRelationshipsSessionMetaFacts,
  facts: PeopleRelationshipsCachedGroupFacts
): void {
  const communityId = `group:${sessionId}`
  communityLabels.set(communityId, meta.name)
  const ownerNode = getOrCreateOwnerNode(nodes, meta)
  const contribution: GroupPanoramaContribution = {
    sessionId,
    memberKeys: new Set(),
    memberMessageCounts: new Map(),
    ownerConnectedKeys: new Set(),
    ownerEdgeScores: new Map(),
    relationshipEdgeIds: new Set(),
    relationshipEdgeEndpoints: new Map(),
    relationshipEdgeScores: new Map(),
    friendConnectedScores: new Map(),
    ownerMessageCount: facts.ownerMessageCount,
  }
  for (const member of facts.members) {
    const node = getOrCreateNode(nodes, sessionId, meta, member.contact)
    contribution.memberKeys.add(node.key)
    contribution.memberMessageCounts.set(node.key, member.messageCount)
    node.groupMessageCount += member.messageCount
    node.commonGroupSessionIds.add(sessionId)
    node.communityWeights.set(
      communityId,
      (node.communityWeights.get(communityId) ?? 0) + Math.max(1, member.messageCount)
    )
    updateLastInteraction(node, member.lastMessageTs)
  }

  if (ownerNode) {
    ownerNode.groupMessageCount += facts.ownerMessageCount
    for (const fact of facts.ownerEdges) {
      if (fact.coOccurrenceCount <= 0 && fact.replyInteractionCount <= 0) continue
      const contactNode = getOrCreateNode(nodes, sessionId, meta, fact.contact)
      const ownerEdgeScore = computeRawEdgeWeight({
        coOccurrenceCount: fact.coOccurrenceCount,
        coOccurrenceRawScore: fact.coOccurrenceRawScore,
        replyInteractionCount: fact.replyInteractionCount,
      })
      contribution.memberKeys.add(contactNode.key)
      contribution.ownerConnectedKeys.add(contactNode.key)
      contribution.ownerEdgeScores.set(
        contactNode.key,
        (contribution.ownerEdgeScores.get(contactNode.key) ?? 0) + ownerEdgeScore
      )
      ownerNode.commonGroupSessionIds.add(sessionId)
      ownerNode.communityWeights.set(communityId, (ownerNode.communityWeights.get(communityId) ?? 0) + 1)
      updateLastInteraction(ownerNode, fact.lastInteractionTs)
      applyOwnerContactEdge(edges, ownerNode, contactNode, {
        coOccurrenceCount: fact.coOccurrenceCount,
        coOccurrenceRawScore: fact.coOccurrenceRawScore,
        replyInteractionCount: fact.replyInteractionCount,
        repliesFromOwnerToContact: fact.repliesFromOwnerToContact,
        repliesFromContactToOwner: fact.repliesFromContactToOwner,
        lastInteractionTs: fact.lastInteractionTs,
        sessionId,
      })
    }
  }

  for (const fact of facts.edges) {
    const sourceNode = getOrCreateNode(nodes, sessionId, meta, fact.source)
    const targetNode = getOrCreateNode(nodes, sessionId, meta, fact.target)
    const sourceKey = sourceNode.key < targetNode.key ? sourceNode.key : targetNode.key
    const targetKey = sourceNode.key < targetNode.key ? targetNode.key : sourceNode.key
    const edge = getOrCreateEdge(edges, sourceKey, targetKey)
    const currentEdgeId = edgeId(sourceKey, targetKey)
    const relationshipEdgeScore = computeRawEdgeWeight(fact)
    contribution.memberKeys.add(sourceNode.key)
    contribution.memberKeys.add(targetNode.key)
    contribution.relationshipEdgeIds.add(currentEdgeId)
    contribution.relationshipEdgeEndpoints.set(currentEdgeId, [sourceKey, targetKey])
    contribution.relationshipEdgeScores.set(
      currentEdgeId,
      (contribution.relationshipEdgeScores.get(currentEdgeId) ?? 0) + relationshipEdgeScore
    )
    edge.coOccurrenceCount += fact.coOccurrenceCount
    edge.coOccurrenceRawScore += fact.coOccurrenceRawScore
    edge.replyInteractionCount += fact.replyInteractionCount
    if (sourceNode.key === sourceKey) {
      edge.repliesFromSourceToTarget += fact.repliesFromSourceToTarget
      edge.repliesFromTargetToSource += fact.repliesFromTargetToSource
    } else {
      edge.repliesFromSourceToTarget += fact.repliesFromTargetToSource
      edge.repliesFromTargetToSource += fact.repliesFromSourceToTarget
    }
    edge.sourceSessionIds.add(sessionId)
    edge.lastInteractionTs = maxNullableTs(edge.lastInteractionTs, fact.lastInteractionTs)
    sourceNode.commonGroupSessionIds.add(sessionId)
    targetNode.commonGroupSessionIds.add(sessionId)
    sourceNode.communityWeights.set(communityId, (sourceNode.communityWeights.get(communityId) ?? 0) + 1)
    targetNode.communityWeights.set(communityId, (targetNode.communityWeights.get(communityId) ?? 0) + 1)
    updateLastInteraction(sourceNode, fact.lastInteractionTs)
    updateLastInteraction(targetNode, fact.lastInteractionTs)
  }
  groupContributions.push(contribution)
}

function buildGraph(
  nodeAccumulators: NodeAccumulator[],
  edgeAccumulators: EdgeAccumulator[],
  communityLabels: Map<string, string>,
  groupContributions: GroupPanoramaContribution[],
  limits: Required<PeopleRelationshipsComputeLimits>,
  baseDiagnostics: PeopleRelationshipsDiagnostics
): BuildGraphResult {
  const edgeWeights = new Map<string, number>()
  for (const edge of edgeAccumulators) {
    const weight = computeEdgeWeight(edge)
    edgeWeights.set(edgeId(edge.sourceKey, edge.targetKey), weight)
  }

  for (const edge of edgeAccumulators) {
    const weight = edgeWeights.get(edgeId(edge.sourceKey, edge.targetKey)) ?? 0
    const source = nodeAccumulators.find((node) => node.key === edge.sourceKey)
    const target = nodeAccumulators.find((node) => node.key === edge.targetKey)
    if (source) source.edgeWeight += weight
    if (target) target.edgeWeight += weight
  }

  const nodeScores = computeContactPriorityScores(nodeAccumulators)
  const rankedNodes = nodeAccumulators
    .map((node) => ({
      node,
      score: nodeScores.get(node) ?? 0,
      relationshipActivityScore: computeRelationshipActivityScore(node),
    }))
    .sort(compareRankedNodes)
  const panoramaCandidateKeys = new Set(
    rankedNodes.filter((item) => item.node.panoramaCandidate).map((item) => item.node.key)
  )
  const panoramaEligibleEdgeIds = new Set(
    edgeAccumulators.filter((edge) => edge.panoramaEligible).map((edge) => edgeId(edge.sourceKey, edge.targetKey))
  )
  const maxScore = Math.max(...rankedNodes.map((item) => item.score), 1)
  const nodeByKey = new Map<string, PeopleRelationshipGraphNode>()

  rankedNodes.forEach((item, index) => {
    const communityId = pickCommunityId(item.node)
    const color = colorForCommunity(communityId)
    nodeByKey.set(item.node.key, {
      key: item.node.key,
      kind: item.node.kind,
      platform: item.node.platform,
      platformId: item.node.platformId,
      sessionScoped: item.node.sessionScoped,
      sessionId: item.node.sessionId,
      displayName: item.node.displayName,
      aliases: [...item.node.aliases].filter((alias) => alias !== item.node.displayName),
      avatar: item.node.avatar,
      pool: item.node.isFriend ? 'friend' : 'non_friend',
      friendSource: item.node.friendSource,
      score: roundNum(item.score),
      rank: index + 1,
      communityId,
      x: 0,
      y: 0,
      size: roundNum(4 + Math.sqrt(item.score / maxScore) * 18, 2),
      color,
      labelVisibility: item.node.kind === 'owner' || index < 30 ? 2 : index < 160 ? 1 : 0,
      lastInteractionTs: item.node.lastInteractionTs,
      privateMessageCount: item.node.privateMessageCount,
      groupMessageCount: item.node.groupMessageCount,
      commonGroupCount: item.node.commonGroupSessionIds.size,
      searchText: [
        item.node.displayName,
        item.node.platformId,
        ...item.node.aliases,
        ...(item.node.kind === 'owner' ? ['我', 'me', 'myself', 'owner'] : []),
      ]
        .join(' ')
        .toLowerCase(),
    })
  })

  const allNodes = layoutNodes([...nodeByKey.values()], communityLabels)
  const allEdges = edgeAccumulators
    .map((edge) => toGraphEdge(edge, edgeWeights.get(edgeId(edge.sourceKey, edge.targetKey)) ?? 0))
    .filter((edge) => nodeByKey.has(edge.sourceKey) && nodeByKey.has(edge.targetKey))
    .sort(compareEdges)
  const communities = buildCommunities(allNodes, communityLabels, groupContributions)
  const coreNodeKeys = new Set(
    allNodes
      .filter((node) => panoramaCandidateKeys.has(node.key))
      .slice(0, limits.coreNodeLimit)
      .map((node) => node.key)
  )
  const coreEdges = cropEdges(
    allEdges.filter(
      (edge) =>
        coreNodeKeys.has(edge.sourceKey) && coreNodeKeys.has(edge.targetKey) && panoramaEligibleEdgeIds.has(edge.id)
    ),
    limits
  )
  const graphNodes = allNodes.filter((node) => coreNodeKeys.has(node.key))
  const graph: PeopleRelationshipsGraphData = {
    nodes: graphNodes,
    edges: coreEdges,
    communities: filterCommunities(communities, graphNodes),
  }
  const diagnostics: PeopleRelationshipsDiagnostics = {
    ...baseDiagnostics,
    totalNodes: allNodes.length,
    totalEdges: allEdges.length,
    panoramaCandidateNodes: panoramaCandidateKeys.size,
    coreNodeCount: graph.nodes.length,
    coreEdgeCount: graph.edges.length,
  }
  return { nodes: allNodes, edges: allEdges, communities, graph, diagnostics }
}

function cropEdges(
  edges: PeopleRelationshipGraphEdge[],
  limits: Required<PeopleRelationshipsComputeLimits>
): PeopleRelationshipGraphEdge[] {
  const counts = new Map<string, number>()
  const kept: PeopleRelationshipGraphEdge[] = []
  for (const edge of sortEdgesForDisplay(edges)) {
    if (kept.length >= limits.coreEdgeLimit) break
    const sourceCount = counts.get(edge.sourceKey) ?? 0
    const targetCount = counts.get(edge.targetKey) ?? 0
    if (sourceCount >= limits.perNodeEdgeLimit || targetCount >= limits.perNodeEdgeLimit) continue
    kept.push(edge)
    counts.set(edge.sourceKey, sourceCount + 1)
    counts.set(edge.targetKey, targetCount + 1)
  }
  return kept
}

function layoutNodes(
  nodes: PeopleRelationshipGraphNode[],
  communityLabels: Map<string, string>
): PeopleRelationshipGraphNode[] {
  const byCommunity = new Map<string, PeopleRelationshipGraphNode[]>()
  for (const node of nodes) {
    const group = byCommunity.get(node.communityId) ?? []
    group.push(node)
    byCommunity.set(node.communityId, group)
  }

  const sortedCommunities = [...byCommunity.entries()].sort((a, b) => {
    if (a[0] === PRIVATE_COMMUNITY_ID) return -1
    if (b[0] === PRIVATE_COMMUNITY_ID) return 1
    const scoreA = a[1].reduce((sum, node) => sum + node.score, 0)
    const scoreB = b[1].reduce((sum, node) => sum + node.score, 0)
    return scoreB - scoreA || (communityLabels.get(a[0]) ?? a[0]).localeCompare(communityLabels.get(b[0]) ?? b[0])
  })

  for (const [communityIndex, [communityId, communityNodes]] of sortedCommunities.entries()) {
    const baseAngle = communityAngle(communityIndex, communityId)
    communityNodes.sort(compareNodes)
    for (const [index, node] of communityNodes.entries()) {
      if (node.kind === 'owner') {
        node.x = 0
        node.y = 0
        continue
      }

      const angle = egoNodeAngle(baseAngle, communityId, node.key, index, communityNodes.length)
      const radius = egoNodeRadius(node, communityId, communityNodes.length)
      node.x = roundNum(Math.cos(angle) * radius, 2)
      node.y = roundNum(Math.sin(angle) * radius, 2)
    }
  }
  return nodes.sort(compareNodes)
}

function communityAngle(index: number, communityId: string): number {
  if (communityId === PRIVATE_COMMUNITY_ID) return -Math.PI / 2
  return index * 2.399963229728653
}

function egoNodeAngle(
  baseAngle: number,
  communityId: string,
  nodeKey: string,
  index: number,
  communitySize: number
): number {
  const seedOffset = ((stableHash(`${communityId}:${nodeKey}:angle`) % 1000) / 1000 - 0.5) * 0.16
  const centeredIndex = index - (communitySize - 1) / 2
  const spacing = communitySize <= 4 ? 0.38 : communitySize <= 12 ? 0.24 : 0.12
  const maxSpread = communitySize <= 4 ? 0.75 : communitySize <= 20 ? 1.1 : 1.35
  return baseAngle + clamp(centeredIndex * spacing + seedOffset, -maxSpread, maxSpread)
}

function egoNodeRadius(node: PeopleRelationshipGraphNode, communityId: string, communitySize: number): number {
  const rankPenalty = Math.sqrt(Math.max(0, node.rank - 1)) * 26
  const scoreBonus = Math.min(260, Math.sqrt(Math.max(0, node.score)) * 22)
  const privateBonus = node.privateMessageCount > 0 ? Math.min(220, Math.log1p(node.privateMessageCount) * 48) : 0
  const friendBonus = node.pool === 'friend' ? 280 : 0
  const commonGroupBonus = Math.min(180, node.commonGroupCount * 18)
  // 大群更可能是同事群、兴趣群或通知群；这里只把它作为布局噪声惩罚，不改变关系评分。
  const groupSizePenalty = communityId.startsWith('group:')
    ? Math.min(1400, Math.max(0, communitySize - 6) * 22 + Math.sqrt(communitySize) * 24)
    : 0
  const baseRadius = node.pool === 'friend' ? 430 : 760
  const minRadius = node.pool === 'friend' ? 160 : 340
  return roundNum(
    clamp(
      baseRadius + rankPenalty + groupSizePenalty - scoreBonus - privateBonus - friendBonus - commonGroupBonus,
      minRadius,
      2600
    ),
    2
  )
}

function buildCommunities(
  nodes: PeopleRelationshipGraphNode[],
  communityLabels: Map<string, string>,
  groupContributions: GroupPanoramaContribution[]
): PeopleRelationshipCommunity[] {
  const groups = new Map<string, PeopleRelationshipGraphNode[]>()
  for (const node of nodes) {
    const group = groups.get(node.communityId) ?? []
    group.push(node)
    groups.set(node.communityId, group)
  }
  const groupMemberCounts = new Map(groupContributions.map((item) => [`group:${item.sessionId}`, item.memberKeys.size]))
  const communitiesById = new Map<string, PeopleRelationshipCommunity>()

  for (const [id, group] of groups) {
    const x = group.reduce((sum, node) => sum + node.x, 0) / group.length
    const y = group.reduce((sum, node) => sum + node.y, 0) / group.length
    communitiesById.set(id, {
      id,
      label: communityLabels.get(id) ?? id,
      size: groupMemberCounts.get(id) ?? group.length,
      x: roundNum(x, 2),
      y: roundNum(y, 2),
      color: colorForCommunity(id),
    })
  }

  for (const [id, label] of communityLabels) {
    if (communitiesById.has(id) || !id.startsWith('group:')) continue
    communitiesById.set(id, {
      id,
      label,
      size: groupMemberCounts.get(id) ?? 0,
      x: 0,
      y: 0,
      color: colorForCommunity(id),
    })
  }

  return [...communitiesById.values()].sort((a, b) => b.size - a.size || a.label.localeCompare(b.label))
}

function filterNeighborhoodCommunities(
  communities: PeopleRelationshipCommunity[],
  relatedEdges: PeopleRelationshipGraphEdge[]
): PeopleRelationshipCommunity[] {
  const communityById = new Map(communities.map((community) => [community.id, community]))
  const sourceCommunityIds = new Set<string>()
  for (const edge of relatedEdges) {
    for (const sessionId of edge.sourceSessionIds) sourceCommunityIds.add(`group:${sessionId}`)
  }
  return [...sourceCommunityIds]
    .map((id) => communityById.get(id))
    .filter((community): community is PeopleRelationshipCommunity => Boolean(community))
    .sort((a, b) => b.size - a.size || a.label.localeCompare(b.label))
}

function filterCommunities(
  communities: PeopleRelationshipCommunity[],
  nodes: PeopleRelationshipGraphNode[]
): PeopleRelationshipCommunity[] {
  const ids = new Set(nodes.map((node) => node.communityId))
  return communities.filter((community) => ids.has(community.id))
}

function applyPanoramaContributions(
  nodes: NodeAccumulator[],
  edges: Map<string, EdgeAccumulator>,
  groupContributions: GroupPanoramaContribution[],
  diagnostics: PeopleRelationshipsDiagnostics
): void {
  const nodeByKey = new Map(nodes.map((node) => [node.key, node]))
  for (const contribution of groupContributions) {
    const decision = evaluateGroupPanoramaContribution(contribution, nodeByKey)
    if (!decision.included) {
      diagnostics.panoramaExcludedLowValueGroupSessions++
      diagnostics.panoramaExcludedGroupMembers += contribution.memberKeys.size
      continue
    }

    diagnostics.panoramaIncludedGroupSessions++
    incrementPanoramaReason(diagnostics, decision.reason)

    for (const key of decision.selectedMemberKeys) {
      const node = nodeByKey.get(key)
      if (node) node.panoramaCandidate = true
    }
    for (const edgeId of contribution.relationshipEdgeIds) {
      const endpoints = contribution.relationshipEdgeEndpoints.get(edgeId)
      if (!endpoints) continue
      if (!decision.selectedMemberKeys.has(endpoints[0]) || !decision.selectedMemberKeys.has(endpoints[1])) continue
      const edge = edges.get(edgeId)
      if (edge) edge.panoramaEligible = true
    }
    for (const key of contribution.ownerConnectedKeys) {
      if (!decision.selectedMemberKeys.has(key)) continue
      const ownerKey = buildOwnerKeyForContribution(nodeByKey, key)
      if (!ownerKey) continue
      const ownerEdgeId = sortedEdgeId(ownerKey, key)
      const edge = edges.get(ownerEdgeId)
      if (edge) edge.panoramaEligible = true
    }

    diagnostics.panoramaIncludedGroupMembers += decision.selectedMemberKeys.size
    diagnostics.panoramaExcludedGroupMembers += Math.max(
      0,
      contribution.memberKeys.size - decision.selectedMemberKeys.size
    )
  }
}

function evaluateGroupPanoramaContribution(
  contribution: GroupPanoramaContribution,
  nodeByKey: Map<string, NodeAccumulator>
): { included: boolean; reason: string; selectedMemberKeys: Set<string> } {
  const friendKeys = [...contribution.memberKeys].filter((key) => nodeByKey.get(key)?.isFriend === true)
  const memberCount = contribution.memberKeys.size
  const friendCount = friendKeys.length
  const friendRatio = memberCount > 0 ? friendCount / memberCount : 0
  const ownerConnectedCount = contribution.ownerConnectedKeys.size
  const totalGroupMessages =
    contribution.ownerMessageCount +
    [...contribution.memberMessageCounts.values()].reduce((sum, count) => sum + count, 0)
  const ownerMessageRatio = totalGroupMessages > 0 ? contribution.ownerMessageCount / totalGroupMessages : 0
  const friendConnectedScores = computeFriendConnectedScores(contribution, new Set(friendKeys))
  contribution.friendConnectedScores.clear()
  for (const [key, score] of friendConnectedScores) contribution.friendConnectedScores.set(key, score)

  let reason: string | null = null
  if (friendCount === 0) {
    reason = null
  } else if (friendCount >= MIN_GROUP_FRIENDS_FOR_PANORAMA) {
    reason = 'friend_count'
  } else if (friendCount >= 2 && friendRatio >= MIN_GROUP_FRIEND_RATIO_FOR_PANORAMA) {
    reason = 'friend_ratio'
  } else if (ownerConnectedCount >= MIN_OWNER_CONNECTED_MEMBERS_FOR_PANORAMA) {
    reason = 'owner_connected'
  } else if (
    contribution.ownerMessageCount >= MIN_OWNER_GROUP_MESSAGES_FOR_PANORAMA ||
    (contribution.ownerMessageCount >= MIN_OWNER_GROUP_MESSAGES_FOR_RATIO &&
      ownerMessageRatio >= MIN_OWNER_GROUP_MESSAGE_RATIO_FOR_PANORAMA)
  ) {
    reason = 'owner_activity'
  } else if (memberCount <= SMALL_GROUP_MEMBER_LIMIT_FOR_FRIEND_EDGE && friendConnectedScores.size > 0) {
    reason = 'friend_connected'
  }

  if (!reason) return { included: false, reason: 'low_value', selectedMemberKeys: new Set() }
  return {
    included: true,
    reason,
    selectedMemberKeys: selectPanoramaMembers(contribution, nodeByKey, new Set(friendKeys)),
  }
}

function computeFriendConnectedScores(
  contribution: GroupPanoramaContribution,
  friendKeys: Set<string>
): Map<string, number> {
  const scores = new Map<string, number>()
  for (const [edgeId, endpoints] of contribution.relationshipEdgeEndpoints) {
    const score = contribution.relationshipEdgeScores.get(edgeId) ?? 0
    const [sourceKey, targetKey] = endpoints
    if (friendKeys.has(sourceKey) && !friendKeys.has(targetKey)) {
      scores.set(targetKey, (scores.get(targetKey) ?? 0) + score)
    } else if (friendKeys.has(targetKey) && !friendKeys.has(sourceKey)) {
      scores.set(sourceKey, (scores.get(sourceKey) ?? 0) + score)
    }
  }
  return scores
}

function selectPanoramaMembers(
  contribution: GroupPanoramaContribution,
  nodeByKey: Map<string, NodeAccumulator>,
  friendKeys: Set<string>
): Set<string> {
  const selected = new Set(friendKeys)
  const remainingLimit = () => Math.max(0, MAX_MEMBERS_PER_GROUP_FOR_PANORAMA - selected.size)

  addTopScoredKeys(selected, contribution.ownerEdgeScores, MAX_OWNER_CONNECTED_NON_FRIENDS_PER_GROUP, remainingLimit())
  addTopScoredKeys(
    selected,
    contribution.friendConnectedScores,
    MAX_FRIEND_CONNECTED_NON_FRIENDS_PER_GROUP,
    remainingLimit()
  )
  addTopScoredKeys(
    selected,
    computeHighSignalNonFriendScores(contribution, nodeByKey, friendKeys),
    MAX_HIGH_SIGNAL_NON_FRIENDS_PER_GROUP,
    remainingLimit()
  )
  return selected
}

function computeHighSignalNonFriendScores(
  contribution: GroupPanoramaContribution,
  nodeByKey: Map<string, NodeAccumulator>,
  friendKeys: Set<string>
): Map<string, number> {
  const scores = new Map<string, number>()
  for (const key of contribution.memberKeys) {
    const node = nodeByKey.get(key)
    if (!node || node.kind === 'owner' || friendKeys.has(key)) continue
    const messageScore = Math.log1p(contribution.memberMessageCounts.get(key) ?? 0)
    const ownerScore = contribution.ownerEdgeScores.get(key) ?? 0
    const friendScore = contribution.friendConnectedScores.get(key) ?? 0
    const relationshipScore = sumRelationshipScoresForKey(contribution, key)
    const score = ownerScore * 2 + friendScore * 1.5 + relationshipScore + messageScore
    if (score > 0) scores.set(key, score)
  }
  return scores
}

function sumRelationshipScoresForKey(contribution: GroupPanoramaContribution, key: string): number {
  let total = 0
  for (const [edgeId, endpoints] of contribution.relationshipEdgeEndpoints) {
    if (endpoints[0] === key || endpoints[1] === key) total += contribution.relationshipEdgeScores.get(edgeId) ?? 0
  }
  return total
}

function addTopScoredKeys(
  selected: Set<string>,
  scores: Map<string, number>,
  limit: number,
  remainingLimit: number
): void {
  if (limit <= 0 || remainingLimit <= 0) return
  const items = [...scores.entries()]
    .filter(([key, score]) => !selected.has(key) && score > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  for (const [key] of items.slice(0, Math.min(limit, remainingLimit))) {
    selected.add(key)
  }
}

function incrementPanoramaReason(diagnostics: PeopleRelationshipsDiagnostics, reason: string): void {
  diagnostics.panoramaGroupInclusionReasons[reason] = (diagnostics.panoramaGroupInclusionReasons[reason] ?? 0) + 1
}

function buildOwnerKeyForContribution(nodeByKey: Map<string, NodeAccumulator>, contactKey: string): string {
  const contact = nodeByKey.get(contactKey)
  return contact ? buildOwnerKey() : ''
}

function toGraphEdge(edge: EdgeAccumulator, weight: number): PeopleRelationshipGraphEdge {
  return {
    id: edgeId(edge.sourceKey, edge.targetKey),
    sourceKey: edge.sourceKey,
    targetKey: edge.targetKey,
    weight: roundNum(weight),
    coOccurrenceCount: edge.coOccurrenceCount,
    coOccurrenceRawScore: roundNum(edge.coOccurrenceRawScore),
    replyInteractionCount: edge.replyInteractionCount,
    repliesFromSourceToTarget: edge.repliesFromSourceToTarget,
    repliesFromTargetToSource: edge.repliesFromTargetToSource,
    sourceGroupCount: edge.sourceSessionIds.size,
    sourceSessionIds: [...edge.sourceSessionIds].sort(),
    lastInteractionTs: edge.lastInteractionTs,
    visibility: weight >= 8 ? 2 : 1,
  }
}

function createFactsCacheContext(dir: string): PeopleRelationshipsFactsCacheContext {
  return {
    dir,
    latestKey: buildPeopleRelationshipsSessionLatestCacheKey(PEOPLE_RELATIONSHIPS_ALGORITHM_VERSION),
    stats: createEmptyPeopleRelationshipsFactsCacheStats(),
  }
}

function readLatestFacts(
  sessionId: string,
  factsCache: PeopleRelationshipsFactsCacheContext | null,
  dbVersion: string
): PeopleRelationshipsSessionLatestFacts | null {
  if (!factsCache) return null
  const cached = readCachedPeopleRelationshipsSessionLatest(sessionId, factsCache.dir, factsCache.latestKey, dbVersion)
  if (!cached.hit) {
    factsCache.stats.latestMisses++
    return null
  }
  factsCache.stats.latestHits++
  return cached.data
}

function writeLatestFacts(
  adapter: SessionRuntimeAdapter,
  sessionId: string,
  factsCache: PeopleRelationshipsFactsCacheContext | null,
  data: PeopleRelationshipsSessionLatestFacts,
  expectedDbVersion: string
): void {
  if (!factsCache) return
  const dbVersion = getSessionDbVersion(adapter, sessionId)
  if (dbVersion !== expectedDbVersion) {
    appLogger.debug('people-relationships', 'skipped latest facts cache write because db version changed', {
      sessionId,
    })
    return
  }
  writeCachedPeopleRelationshipsSessionLatest(sessionId, factsCache.dir, factsCache.latestKey, dbVersion, data)
  factsCache.stats.writes++
}

function readSessionFacts(
  sessionId: string,
  timeRange: ContactsTimeRangeState,
  factsCache: PeopleRelationshipsFactsCacheContext | null,
  dbVersion: string
): PeopleRelationshipsSessionFacts | null {
  if (!factsCache) return null
  const cached = readCachedPeopleRelationshipsSessionFacts(
    sessionId,
    factsCache.dir,
    buildPeopleRelationshipsSessionFactsCacheKey(PEOPLE_RELATIONSHIPS_ALGORITHM_VERSION, timeRange),
    dbVersion
  )
  if (!cached.hit) {
    factsCache.stats.factsMisses++
    return null
  }
  factsCache.stats.factsHits++
  return cached.data
}

function writeSessionFacts(
  adapter: SessionRuntimeAdapter,
  sessionId: string,
  timeRange: ContactsTimeRangeState,
  factsCache: PeopleRelationshipsFactsCacheContext | null,
  facts: PeopleRelationshipsSessionFacts,
  expectedDbVersion: string
): void {
  if (!factsCache) return
  const dbVersion = getSessionDbVersion(adapter, sessionId)
  if (dbVersion !== expectedDbVersion) {
    appLogger.debug('people-relationships', 'skipped session facts cache write because db version changed', {
      sessionId,
    })
    return
  }
  writeCachedPeopleRelationshipsSessionFacts(
    sessionId,
    factsCache.dir,
    buildPeopleRelationshipsSessionFactsCacheKey(PEOPLE_RELATIONSHIPS_ALGORITHM_VERSION, timeRange),
    dbVersion,
    facts
  )
  writeCachedPeopleRelationshipsSessionLatest(sessionId, factsCache.dir, factsCache.latestKey, dbVersion, {
    latestMessageTs: facts.latestMessageTs,
  })
  factsCache.stats.writes += 2
}

function getSessionDbVersion(adapter: SessionRuntimeAdapter, sessionId: string): string {
  return getDbFileVersion(adapter.getDbPath(sessionId))
}

function getOrCreateNode(
  nodes: Map<string, NodeAccumulator>,
  sessionId: string,
  meta: PeopleRelationshipsSessionMetaFacts,
  contact: ContactMemberRef
): NodeAccumulator {
  const sessionScoped = shouldScopeContactToSession(meta.platform, contact)
  const key = buildContactKey(meta.platform, contact.platformId, sessionScoped ? sessionId : undefined)
  const existing = nodes.get(key)
  if (existing) {
    mergeContactIdentity(existing, contact)
    return existing
  }

  const created: NodeAccumulator = {
    key,
    kind: 'contact',
    platform: meta.platform,
    platformId: contact.platformId,
    sessionScoped,
    sessionId: sessionScoped ? sessionId : undefined,
    displayName: contact.name || contact.platformId,
    aliases: new Set([contact.platformId, contact.name, ...contact.aliases].filter(Boolean)),
    avatar: contact.avatar,
    isFriend: false,
    privateMessageCount: 0,
    activePrivateMonths: new Set(),
    groupMessageCount: 0,
    commonGroupSessionIds: new Set(),
    ownerCoOccurrenceCount: 0,
    ownerCoOccurrenceRawScore: 0,
    ownerReplyInteractionCount: 0,
    ownerRepliesFromOwnerToContact: 0,
    ownerRepliesFromContactToOwner: 0,
    communityWeights: new Map(),
    edgeWeight: 0,
    panoramaCandidate: false,
    lastInteractionTs: null,
  }
  nodes.set(key, created)
  return created
}

function getOrCreateOwnerNode(
  nodes: Map<string, NodeAccumulator>,
  meta: PeopleRelationshipsSessionMetaFacts
): NodeAccumulator | null {
  if (!meta.owner) return null
  const key = buildOwnerKey()
  const existing = nodes.get(key)
  if (existing) {
    mergeContactIdentity(existing, meta.owner)
    return existing
  }

  const created: NodeAccumulator = {
    key,
    kind: 'owner',
    platform: meta.platform,
    platformId: meta.owner.platformId || meta.ownerId || OWNER_KEY_PREFIX,
    sessionScoped: false,
    displayName: meta.owner.name || meta.owner.platformId || 'Me',
    aliases: new Set(
      [meta.owner.platformId, meta.owner.name, ...meta.owner.aliases, '我', 'me', 'owner'].filter(Boolean)
    ),
    avatar: meta.owner.avatar,
    isFriend: true,
    privateMessageCount: 0,
    activePrivateMonths: new Set(),
    groupMessageCount: 0,
    commonGroupSessionIds: new Set(),
    ownerCoOccurrenceCount: 0,
    ownerCoOccurrenceRawScore: 0,
    ownerReplyInteractionCount: 0,
    ownerRepliesFromOwnerToContact: 0,
    ownerRepliesFromContactToOwner: 0,
    communityWeights: new Map(),
    edgeWeight: 0,
    panoramaCandidate: true,
    lastInteractionTs: null,
  }
  nodes.set(key, created)
  return created
}

function applyOwnerContactEdge(
  edges: Map<string, EdgeAccumulator>,
  ownerNode: NodeAccumulator,
  contactNode: NodeAccumulator,
  facts: {
    coOccurrenceCount: number
    coOccurrenceRawScore: number
    replyInteractionCount: number
    repliesFromOwnerToContact: number
    repliesFromContactToOwner: number
    lastInteractionTs: number | null
    sessionId: string
    panoramaEligible?: boolean
  }
): void {
  const sourceKey = ownerNode.key < contactNode.key ? ownerNode.key : contactNode.key
  const targetKey = ownerNode.key < contactNode.key ? contactNode.key : ownerNode.key
  const edge = getOrCreateEdge(edges, sourceKey, targetKey)
  edge.coOccurrenceCount += facts.coOccurrenceCount
  edge.coOccurrenceRawScore += facts.coOccurrenceRawScore
  edge.replyInteractionCount += facts.replyInteractionCount
  if (sourceKey === ownerNode.key) {
    edge.repliesFromSourceToTarget += facts.repliesFromOwnerToContact
    edge.repliesFromTargetToSource += facts.repliesFromContactToOwner
  } else {
    edge.repliesFromSourceToTarget += facts.repliesFromContactToOwner
    edge.repliesFromTargetToSource += facts.repliesFromOwnerToContact
  }
  edge.sourceSessionIds.add(facts.sessionId)
  if (facts.panoramaEligible) edge.panoramaEligible = true
  edge.lastInteractionTs = maxNullableTs(edge.lastInteractionTs, facts.lastInteractionTs)
  contactNode.ownerCoOccurrenceCount += facts.coOccurrenceCount
  contactNode.ownerCoOccurrenceRawScore += facts.coOccurrenceRawScore
  contactNode.ownerReplyInteractionCount += facts.replyInteractionCount
  contactNode.ownerRepliesFromOwnerToContact += facts.repliesFromOwnerToContact
  contactNode.ownerRepliesFromContactToOwner += facts.repliesFromContactToOwner
  updateLastInteraction(contactNode, facts.lastInteractionTs)
}

function getOrCreateEdge(edges: Map<string, EdgeAccumulator>, sourceKey: string, targetKey: string): EdgeAccumulator {
  const id = edgeId(sourceKey, targetKey)
  const existing = edges.get(id)
  if (existing) return existing
  const created: EdgeAccumulator = {
    sourceKey,
    targetKey,
    coOccurrenceCount: 0,
    coOccurrenceRawScore: 0,
    replyInteractionCount: 0,
    repliesFromSourceToTarget: 0,
    repliesFromTargetToSource: 0,
    sourceSessionIds: new Set(),
    panoramaEligible: false,
    lastInteractionTs: null,
  }
  edges.set(id, created)
  return created
}

function toPeopleRelationshipsSessionMetaFacts(
  meta: SessionMeta,
  owner?: ContactMemberRef
): PeopleRelationshipsSessionMetaFacts {
  return {
    name: meta.name,
    platform: meta.platform,
    type: meta.type as ChatType.PRIVATE | ChatType.GROUP,
    ownerId: meta.ownerId,
    owner,
  }
}

function shouldScopeContactToSession(platform: ChatPlatform, contact: ContactMemberRef): boolean {
  if (isNameMatchPlatform(platform)) return true
  return platform.trim().toLowerCase() === 'qq' && contact.platformId.trim() === contact.name.trim()
}

function buildContactKey(platform: ChatPlatform, platformId: string, sessionId?: string): string {
  const normalizedPlatform = platform.trim()
  const normalizedPlatformId = platformId.trim()
  if (!normalizedPlatform) throw new Error('platform is required')
  if (!normalizedPlatformId) throw new Error('platformId is required')
  return sessionId?.trim()
    ? `${normalizedPlatform}:${sessionId.trim()}:${normalizedPlatformId}`
    : `${normalizedPlatform}:${normalizedPlatformId}`
}

function buildOwnerKey(): string {
  return OWNER_KEY_PREFIX
}

function mergeContactIdentity(acc: NodeAccumulator, contact: ContactMemberRef): void {
  if (contact.name) acc.aliases.add(contact.name)
  acc.aliases.add(contact.platformId)
  for (const alias of contact.aliases) acc.aliases.add(alias)
  if ((!acc.displayName || acc.displayName === acc.platformId) && contact.name) acc.displayName = contact.name
  if (!acc.avatar && contact.avatar) acc.avatar = contact.avatar
}

function pickCommunityId(node: NodeAccumulator): string {
  let bestId = node.isFriend ? PRIVATE_COMMUNITY_ID : ''
  let bestWeight = node.isFriend ? 1 : 0
  for (const [id, weight] of node.communityWeights) {
    if (weight > bestWeight || (weight === bestWeight && id < bestId)) {
      bestId = id
      bestWeight = weight
    }
  }
  return bestId || PRIVATE_COMMUNITY_ID
}

function computeEdgeWeight(edge: EdgeAccumulator): number {
  return computeRawEdgeWeight(edge)
}

function computeRawEdgeWeight(edge: {
  coOccurrenceRawScore: number
  replyInteractionCount: number
  coOccurrenceCount: number
}): number {
  return (
    edge.coOccurrenceRawScore +
    edge.replyInteractionCount * REPLY_WEIGHT +
    edge.coOccurrenceCount * CO_OCCURRENCE_COUNT_WEIGHT
  )
}

// 默认全景优先级复用联系人页评分；关系边权只作为同分时的补充，避免大群活跃成员挤掉真正联系人。
function computeContactPriorityScores(nodes: NodeAccumulator[]): Map<NodeAccumulator, number> {
  const result = new Map<NodeAccumulator, number>()
  for (const node of nodes) {
    if (node.kind === 'owner') result.set(node, 1)
  }

  const friendInputs = nodes
    .filter((node) => node.kind !== 'owner' && node.isFriend)
    .map((node) => ({
      node,
      privateMessageCount: node.privateMessageCount,
      activeMonths: [...node.activePrivateMonths],
      commonGroupCount: node.commonGroupSessionIds.size,
    }))
  const nonFriendInputs = nodes
    .filter((node) => node.kind !== 'owner' && !node.isFriend)
    .map((node) => ({
      node,
      coOccurrenceRawScore: node.ownerCoOccurrenceRawScore,
      commonGroupCount: node.commonGroupSessionIds.size,
      replyInteractionCount: node.ownerReplyInteractionCount,
      coOccurrenceCount: node.ownerCoOccurrenceCount,
      repliesFromOwnerToContact: node.ownerRepliesFromOwnerToContact,
      repliesFromContactToOwner: node.ownerRepliesFromContactToOwner,
    }))

  const friendScores = computeFriendScores(friendInputs)
  const nonFriendScores = computeNonFriendScores(nonFriendInputs)
  for (const input of friendInputs) {
    result.set(input.node, friendScores.get(input)?.score ?? 0)
  }
  for (const input of nonFriendInputs) {
    result.set(input.node, nonFriendScores.get(input)?.score ?? 0)
  }
  return result
}

function compareRankedNodes(
  a: { node: NodeAccumulator; score: number; relationshipActivityScore: number },
  b: { node: NodeAccumulator; score: number; relationshipActivityScore: number }
): number {
  const poolPriorityDiff = getNodePoolPriority(a.node) - getNodePoolPriority(b.node)
  if (poolPriorityDiff !== 0) return poolPriorityDiff
  return (
    b.score - a.score ||
    b.relationshipActivityScore - a.relationshipActivityScore ||
    a.node.displayName.localeCompare(b.node.displayName)
  )
}

function getNodePoolPriority(node: NodeAccumulator): number {
  if (node.kind === 'owner') return 0
  return node.isFriend ? 1 : 2
}

function computeRelationshipActivityScore(node: NodeAccumulator): number {
  return (
    (node.isFriend ? 60 : 0) +
    node.privateMessageCount * 1.8 +
    node.groupMessageCount * 0.35 +
    node.commonGroupSessionIds.size * 8 +
    node.edgeWeight * 6
  )
}

function normalizeLimits(limits: PeopleRelationshipsComputeLimits = {}): Required<PeopleRelationshipsComputeLimits> {
  return {
    coreNodeLimit: normalizePositiveLimit(limits.coreNodeLimit, 1500),
    coreEdgeLimit: normalizePositiveLimit(limits.coreEdgeLimit, 6000),
    perNodeEdgeLimit: normalizePositiveLimit(limits.perNodeEdgeLimit, 12),
    neighborhoodNodeLimit: normalizePositiveLimit(limits.neighborhoodNodeLimit, 80),
    neighborhoodEdgeLimit: normalizePositiveLimit(limits.neighborhoodEdgeLimit, 240),
    searchResultLimit: normalizePositiveLimit(limits.searchResultLimit, 20),
  }
}

function normalizePositiveLimit(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(1, Math.trunc(value!))
}

function createEmptyDiagnostics(): PeopleRelationshipsDiagnostics {
  return {
    processedPrivateSessions: 0,
    processedGroupSessions: 0,
    skippedMissingOwnerSessions: 0,
    skippedUnresolvedOwnerSessions: 0,
    skippedAmbiguousPrivateSessions: 0,
    skippedFailedSessions: 0,
    totalNodes: 0,
    totalEdges: 0,
    panoramaIncludedGroupSessions: 0,
    panoramaExcludedLowValueGroupSessions: 0,
    panoramaIncludedGroupMembers: 0,
    panoramaExcludedGroupMembers: 0,
    panoramaCandidateNodes: 0,
    panoramaGroupInclusionReasons: {},
    coreNodeCount: 0,
    coreEdgeCount: 0,
    warnings: [],
  }
}

function updateLastInteraction(acc: NodeAccumulator, ts: number | null): void {
  acc.lastInteractionTs = maxNullableTs(acc.lastInteractionTs, ts)
}

function maxNullableTs(current: number | null, next: number | null): number | null {
  if (next === null) return current
  return Math.max(current ?? 0, next)
}

function edgeId(sourceKey: string, targetKey: string): string {
  return `${sourceKey}__${targetKey}`
}

function sortedEdgeId(aKey: string, bKey: string): string {
  return aKey < bKey ? edgeId(aKey, bKey) : edgeId(bKey, aKey)
}

function colorForCommunity(id: string): string {
  return COMMUNITY_COLORS[stableHash(id) % COMMUNITY_COLORS.length]
}

function stableHash(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function compareNodes(a: PeopleRelationshipGraphNode, b: PeopleRelationshipGraphNode): number {
  return a.rank - b.rank || a.displayName.localeCompare(b.displayName)
}

export function compareEdges(a: PeopleRelationshipGraphEdge, b: PeopleRelationshipGraphEdge): number {
  return b.weight - a.weight || a.id.localeCompare(b.id)
}

function sortEdgesForDisplay(edges: PeopleRelationshipGraphEdge[]): PeopleRelationshipGraphEdge[] {
  const anchorTs = edges.reduce((max, edge) => Math.max(max, edge.lastInteractionTs ?? 0), 0)
  return [...edges].sort((a, b) => compareEdgesForDisplay(a, b, anchorTs))
}

function compareEdgesForDisplay(
  a: PeopleRelationshipGraphEdge,
  b: PeopleRelationshipGraphEdge,
  anchorTs: number
): number {
  const bRecentWeight = getRecentEdgeWeight(b, anchorTs)
  const aRecentWeight = getRecentEdgeWeight(a, anchorTs)
  if (bRecentWeight !== aRecentWeight) return bRecentWeight - aRecentWeight
  return compareEdges(a, b)
}

function getRecentEdgeWeight(edge: PeopleRelationshipGraphEdge, anchorTs: number): number {
  if (!edge.lastInteractionTs || anchorTs <= 0) return edge.weight
  const ageSeconds = Math.max(0, anchorTs - edge.lastInteractionTs)
  const recencyFactor =
    EDGE_RECENCY_FLOOR + (1 - EDGE_RECENCY_FLOOR) * Math.pow(0.5, ageSeconds / EDGE_RECENCY_HALF_LIFE_SECONDS)
  return edge.weight * recencyFactor
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function roundNum(value: number, digits = 4): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
