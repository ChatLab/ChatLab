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

export const PEOPLE_RELATIONSHIPS_ALGORITHM_VERSION = 'people-relationships-v1'

const PRIVATE_COMMUNITY_ID = 'private'
const REPLY_WEIGHT = 3
const CO_OCCURRENCE_COUNT_WEIGHT = 0.05

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
  groupMessageCount: number
  commonGroupSessionIds: Set<string>
  communityWeights: Map<string, number>
  edgeWeight: number
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
  lastInteractionTs: number | null
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

  const relatedEdges = snapshot.edges
    .filter((edge) => edge.sourceKey === contactKey || edge.targetKey === contactKey)
    .sort(compareEdges)
  const nodeKeys = new Set<string>([contactKey])
  for (const edge of relatedEdges) {
    if (nodeKeys.size >= normalizedLimits.neighborhoodNodeLimit) break
    nodeKeys.add(edge.sourceKey === contactKey ? edge.targetKey : edge.sourceKey)
  }

  const edges = snapshot.edges
    .filter((edge) => nodeKeys.has(edge.sourceKey) && nodeKeys.has(edge.targetKey))
    .sort(compareEdges)
    .slice(0, normalizedLimits.neighborhoodEdgeLimit)
  const nodes = snapshot.nodes.filter((node) => nodeKeys.has(node.key)).sort(compareNodes)
  return {
    nodes,
    edges,
    communities: filterCommunities(snapshot.communities, nodes),
  }
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
  const communityLabels = new Map<string, string>([[PRIVATE_COMMUNITY_ID, 'Private contacts']])
  let processedSessions = 0

  for (const sessionId of options.sessionIds) {
    options.onProgress?.({ processedSessions, totalSessions: options.sessionIds.length, currentSessionId: sessionId })
    try {
      const facts = getSessionFacts(options.adapter, sessionId, options.timeRange, options.factsCache)
      applySessionFacts(nodes, edges, communityLabels, diagnostics, sessionId, facts)
    } catch (error) {
      diagnostics.skippedFailedSessions++
      appLogger.error('people-relationships', `failed to process people relationship session: ${sessionId}`, error)
    } finally {
      processedSessions++
      options.onProgress?.({ processedSessions, totalSessions: options.sessionIds.length, currentSessionId: sessionId })
    }
  }

  return buildGraph([...nodes.values()], [...edges.values()], communityLabels, options.limits, diagnostics)
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

  if (meta.type === ChatType.PRIVATE) {
    const facts = getPrivateContactFacts(db, owner.id, { startTs: timeRange.startTs })
    if (facts.type === 'missing') return { kind: 'private_missing', meta: cachedMeta, latestMessageTs }
    if (facts.type === 'ambiguous') return { kind: 'private_ambiguous', meta: cachedMeta, latestMessageTs }
    return { kind: 'private', meta: cachedMeta, latestMessageTs, facts }
  }

  return {
    kind: 'group',
    meta: cachedMeta,
    latestMessageTs,
    facts: getGroupRelationshipGraphFacts(db, owner.id, { startTs: timeRange.startTs }),
  }
}

function applySessionFacts(
  nodes: Map<string, NodeAccumulator>,
  edges: Map<string, EdgeAccumulator>,
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
      applyPrivateFacts(nodes, sessionId, sessionFacts.meta, sessionFacts.facts)
      return
    case 'group':
      diagnostics.processedGroupSessions++
      applyGroupFacts(nodes, edges, communityLabels, sessionId, sessionFacts.meta, sessionFacts.facts)
      return
    default:
      return
  }
}

function applyPrivateFacts(
  nodes: Map<string, NodeAccumulator>,
  sessionId: string,
  meta: PeopleRelationshipsSessionMetaFacts,
  facts: PeopleRelationshipsCachedPrivateFacts
): void {
  if (facts.privateMessageCount <= 0) return
  const node = getOrCreateNode(nodes, sessionId, meta, facts.contact)
  node.isFriend = true
  node.friendSource = 'private'
  node.privateMessageCount += facts.privateMessageCount
  node.communityWeights.set(PRIVATE_COMMUNITY_ID, (node.communityWeights.get(PRIVATE_COMMUNITY_ID) ?? 0) + 1)
  updateLastInteraction(node, facts.lastMessageTs)
}

function applyGroupFacts(
  nodes: Map<string, NodeAccumulator>,
  edges: Map<string, EdgeAccumulator>,
  communityLabels: Map<string, string>,
  sessionId: string,
  meta: PeopleRelationshipsSessionMetaFacts,
  facts: PeopleRelationshipsCachedGroupFacts
): void {
  const communityId = `group:${sessionId}`
  communityLabels.set(communityId, meta.name)
  for (const member of facts.members) {
    const node = getOrCreateNode(nodes, sessionId, meta, member.contact)
    node.groupMessageCount += member.messageCount
    node.commonGroupSessionIds.add(sessionId)
    node.communityWeights.set(
      communityId,
      (node.communityWeights.get(communityId) ?? 0) + Math.max(1, member.messageCount)
    )
    updateLastInteraction(node, member.lastMessageTs)
  }

  for (const fact of facts.edges) {
    const sourceNode = getOrCreateNode(nodes, sessionId, meta, fact.source)
    const targetNode = getOrCreateNode(nodes, sessionId, meta, fact.target)
    const sourceKey = sourceNode.key < targetNode.key ? sourceNode.key : targetNode.key
    const targetKey = sourceNode.key < targetNode.key ? targetNode.key : sourceNode.key
    const edge = getOrCreateEdge(edges, sourceKey, targetKey)
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
}

function buildGraph(
  nodeAccumulators: NodeAccumulator[],
  edgeAccumulators: EdgeAccumulator[],
  communityLabels: Map<string, string>,
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

  const rankedNodes = nodeAccumulators
    .map((node) => ({ node, score: computeNodeScore(node) }))
    .sort((a, b) => b.score - a.score || a.node.displayName.localeCompare(b.node.displayName))
  const maxScore = Math.max(...rankedNodes.map((item) => item.score), 1)
  const nodeByKey = new Map<string, PeopleRelationshipGraphNode>()

  rankedNodes.forEach((item, index) => {
    const communityId = pickCommunityId(item.node)
    const color = colorForCommunity(communityId)
    nodeByKey.set(item.node.key, {
      key: item.node.key,
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
      labelVisibility: index < 30 ? 2 : index < 160 ? 1 : 0,
      lastInteractionTs: item.node.lastInteractionTs,
      privateMessageCount: item.node.privateMessageCount,
      groupMessageCount: item.node.groupMessageCount,
      commonGroupCount: item.node.commonGroupSessionIds.size,
      searchText: [item.node.displayName, item.node.platformId, ...item.node.aliases].join(' ').toLowerCase(),
    })
  })

  const allNodes = layoutNodes([...nodeByKey.values()], communityLabels)
  const allEdges = edgeAccumulators
    .map((edge) => toGraphEdge(edge, edgeWeights.get(edgeId(edge.sourceKey, edge.targetKey)) ?? 0))
    .filter((edge) => nodeByKey.has(edge.sourceKey) && nodeByKey.has(edge.targetKey))
    .sort(compareEdges)
  const communities = buildCommunities(allNodes, communityLabels)
  const coreNodeKeys = new Set(allNodes.slice(0, limits.coreNodeLimit).map((node) => node.key))
  const coreEdges = cropEdges(
    allEdges.filter((edge) => coreNodeKeys.has(edge.sourceKey) && coreNodeKeys.has(edge.targetKey)),
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
  for (const edge of edges) {
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
    const scoreA = a[1].reduce((sum, node) => sum + node.score, 0)
    const scoreB = b[1].reduce((sum, node) => sum + node.score, 0)
    return scoreB - scoreA || (communityLabels.get(a[0]) ?? a[0]).localeCompare(communityLabels.get(b[0]) ?? b[0])
  })

  for (const [communityIndex, [communityId, communityNodes]] of sortedCommunities.entries()) {
    const center = communityCenter(communityIndex, sortedCommunities.length)
    communityNodes.sort(compareNodes)
    for (const [index, node] of communityNodes.entries()) {
      const seed = stableHash(`${communityId}:${node.key}`)
      const angle = (seed % 6283) / 1000 + index * 0.82
      const radius = index === 0 ? 0 : 24 + Math.sqrt(index) * 28 + (seed % 17)
      node.x = roundNum(center.x + Math.cos(angle) * radius, 2)
      node.y = roundNum(center.y + Math.sin(angle) * radius, 2)
    }
  }
  return nodes.sort(compareNodes)
}

function communityCenter(index: number, total: number): { x: number; y: number } {
  if (total <= 1) return { x: 0, y: 0 }
  const angle = index * 2.399963229728653
  const radius = 260 + Math.sqrt(index) * 300
  return {
    x: roundNum(Math.cos(angle) * radius, 2),
    y: roundNum(Math.sin(angle) * radius, 2),
  }
}

function buildCommunities(
  nodes: PeopleRelationshipGraphNode[],
  communityLabels: Map<string, string>
): PeopleRelationshipCommunity[] {
  const groups = new Map<string, PeopleRelationshipGraphNode[]>()
  for (const node of nodes) {
    const group = groups.get(node.communityId) ?? []
    group.push(node)
    groups.set(node.communityId, group)
  }
  return [...groups.entries()]
    .map(([id, group]) => {
      const x = group.reduce((sum, node) => sum + node.x, 0) / group.length
      const y = group.reduce((sum, node) => sum + node.y, 0) / group.length
      return {
        id,
        label: communityLabels.get(id) ?? id,
        size: group.length,
        x: roundNum(x, 2),
        y: roundNum(y, 2),
        color: colorForCommunity(id),
      }
    })
    .sort((a, b) => b.size - a.size || a.label.localeCompare(b.label))
}

function filterCommunities(
  communities: PeopleRelationshipCommunity[],
  nodes: PeopleRelationshipGraphNode[]
): PeopleRelationshipCommunity[] {
  const ids = new Set(nodes.map((node) => node.communityId))
  return communities.filter((community) => ids.has(community.id))
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
    platform: meta.platform,
    platformId: contact.platformId,
    sessionScoped,
    sessionId: sessionScoped ? sessionId : undefined,
    displayName: contact.name || contact.platformId,
    aliases: new Set([contact.platformId, contact.name, ...contact.aliases].filter(Boolean)),
    avatar: contact.avatar,
    isFriend: false,
    privateMessageCount: 0,
    groupMessageCount: 0,
    commonGroupSessionIds: new Set(),
    communityWeights: new Map(),
    edgeWeight: 0,
    lastInteractionTs: null,
  }
  nodes.set(key, created)
  return created
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
    lastInteractionTs: null,
  }
  edges.set(id, created)
  return created
}

function toPeopleRelationshipsSessionMetaFacts(meta: SessionMeta): PeopleRelationshipsSessionMetaFacts {
  return {
    name: meta.name,
    platform: meta.platform,
    type: meta.type as ChatType.PRIVATE | ChatType.GROUP,
    ownerId: meta.ownerId,
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
  return (
    edge.coOccurrenceRawScore +
    edge.replyInteractionCount * REPLY_WEIGHT +
    edge.coOccurrenceCount * CO_OCCURRENCE_COUNT_WEIGHT
  )
}

function computeNodeScore(node: NodeAccumulator): number {
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
    perNodeEdgeLimit: normalizePositiveLimit(limits.perNodeEdgeLimit, 8),
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

function roundNum(value: number, digits = 4): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
