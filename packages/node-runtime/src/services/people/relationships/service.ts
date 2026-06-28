import type { PathProvider } from '@openchatlab/core'
import type {
  ContactsTimeRangePreset,
  PeopleRelationshipCommunity,
  PeopleRelationshipsGraphData,
  PeopleRelationshipsCacheState,
  PeopleRelationshipsDiagnostics,
  PeopleRelationshipsGraphScope,
  PeopleRelationshipsGraphResponse,
  PeopleRelationshipsNeighborhoodResponse,
  PeopleRelationshipsSearchResult,
  PeopleRelationshipsTaskState,
} from '@openchatlab/shared-types'
import type { RuntimeIdentity } from '../../../data-dir-compat'
import { appLogger } from '../../../logging/app-logger'
import type { SessionRuntimeAdapter } from '../../adapters'
import {
  buildPeopleRelationshipsNeighborhoodGraph,
  compareNodes,
  PEOPLE_RELATIONSHIPS_ALGORITHM_VERSION,
  type PeopleRelationshipsComputeProgress,
  type PeopleRelationshipsSnapshot,
} from './compute'
import { getPeopleRelationshipsDir } from './paths'
import { buildPeopleRelationshipsSignature } from './signature'
import {
  cleanupPeopleRelationshipsSnapshotTempFiles,
  readPeopleRelationshipsSnapshot,
  writePeopleRelationshipsSnapshot,
} from './snapshot'
import { normalizePeopleRelationshipsTimeRangePreset, resolvePeopleRelationshipsTimeRange } from './time-range'
import { createPeopleRelationshipsWorkerRunner } from './worker-runner'

export interface PeopleRelationshipsServiceOptions {
  forceRecompute?: boolean
  acceptStale?: boolean
  timeRangePreset?: ContactsTimeRangePreset
  graphScope?: PeopleRelationshipsGraphScope
  query?: string
}

export interface PeopleRelationshipsRunnerOptions {
  signature: string
  timeRangePreset: ContactsTimeRangePreset
  onProgress: (progress: PeopleRelationshipsComputeProgress) => void
  signal: AbortSignal
}

export type PeopleRelationshipsComputeRunner = (
  options: PeopleRelationshipsRunnerOptions
) => Promise<PeopleRelationshipsSnapshot>

export interface PeopleRelationshipsServiceDeps {
  adapter: SessionRuntimeAdapter
  systemDir?: string
  pathProvider?: PathProvider
  runtimeIdentity?: RuntimeIdentity
  nativeBinding?: string
  workerEntryUrl?: string | URL
  runner?: PeopleRelationshipsComputeRunner
  now?: () => number
}

export interface PeopleRelationshipsService {
  getGraph(options?: PeopleRelationshipsServiceOptions): PeopleRelationshipsGraphResponse
  getNeighborhood(key: string, options?: PeopleRelationshipsServiceOptions): PeopleRelationshipsNeighborhoodResponse
  startRecompute(options?: PeopleRelationshipsServiceOptions): PeopleRelationshipsGraphResponse
  invalidateRelationshipsCache(): void
  close(): Promise<void>
  replaceSnapshotForTests?(snapshot: PeopleRelationshipsSnapshot): void
}

interface InFlightTask {
  id: string
  signature: string
  promise: Promise<PeopleRelationshipsSnapshot>
  abortController: AbortController
}

const CLOSE_GRAPH_NON_FRIEND_LIMIT = 50

export function createPeopleRelationshipsService(deps: PeopleRelationshipsServiceDeps): PeopleRelationshipsService {
  return new DefaultPeopleRelationshipsService(deps)
}

class DefaultPeopleRelationshipsService implements PeopleRelationshipsService {
  private readonly snapshots = new Map<ContactsTimeRangePreset, PeopleRelationshipsSnapshot | null>()
  private inFlight: InFlightTask | null = null
  private task: PeopleRelationshipsTaskState = createIdleTaskState()
  private readonly snapshotDir: string
  private readonly runner: PeopleRelationshipsComputeRunner

  constructor(private readonly deps: PeopleRelationshipsServiceDeps) {
    this.snapshotDir = resolvePeopleRelationshipsSnapshotDir(deps)
    cleanupPeopleRelationshipsSnapshotTempFiles(this.snapshotDir)
    this.runner =
      deps.runner ??
      createPeopleRelationshipsWorkerRunner({
        pathProvider: requirePathProvider(deps),
        runtimeIdentity: deps.runtimeIdentity,
        nativeBinding: deps.nativeBinding,
        workerEntryUrl: deps.workerEntryUrl,
      })
  }

  getGraph(options: PeopleRelationshipsServiceOptions = {}): PeopleRelationshipsGraphResponse {
    const timeRangePreset = normalizePeopleRelationshipsTimeRangePreset(options.timeRangePreset)
    const signature = buildPeopleRelationshipsSignature(this.deps.adapter, timeRangePreset)
    const cacheStatus = this.getCacheStatus(signature, timeRangePreset)
    if (this.shouldStartTaskFromRead(options, cacheStatus)) this.ensureTaskStarted(signature, timeRangePreset)
    return this.toGraphResponse(signature, { ...options, timeRangePreset })
  }

  getNeighborhood(
    key: string,
    options: PeopleRelationshipsServiceOptions = {}
  ): PeopleRelationshipsNeighborhoodResponse {
    const timeRangePreset = normalizePeopleRelationshipsTimeRangePreset(options.timeRangePreset)
    const signature = buildPeopleRelationshipsSignature(this.deps.adapter, timeRangePreset)
    const cacheStatus = this.getCacheStatus(signature, timeRangePreset)
    if (this.shouldStartTaskFromRead(options, cacheStatus)) this.ensureTaskStarted(signature, timeRangePreset)
    const snapshot = this.getSnapshot(timeRangePreset)
    const status = this.getCacheStatus(signature, timeRangePreset)
    const includeSnapshot = shouldIncludeSnapshot(status, options.acceptStale)
    const graph = includeSnapshot && snapshot ? buildPeopleRelationshipsNeighborhoodGraph(snapshot, key) : emptyGraph()
    const contact = includeSnapshot ? (snapshot?.nodes.find((node) => node.key === key) ?? null) : null
    return {
      contact,
      graph,
      diagnostics: includeSnapshot
        ? sanitizePeopleRelationshipsDiagnostics(snapshot?.diagnostics ?? createEmptyDiagnostics())
        : createEmptyDiagnostics(),
      algorithmVersion: includeSnapshot
        ? (snapshot?.algorithmVersion ?? PEOPLE_RELATIONSHIPS_ALGORITHM_VERSION)
        : PEOPLE_RELATIONSHIPS_ALGORITHM_VERSION,
      timeRange: snapshot?.timeRange ?? resolvePeopleRelationshipsTimeRange(timeRangePreset, null),
      cache: this.toCacheState(status, snapshot),
      task: this.task,
    }
  }

  startRecompute(options: PeopleRelationshipsServiceOptions = {}): PeopleRelationshipsGraphResponse {
    const timeRangePreset = normalizePeopleRelationshipsTimeRangePreset(options.timeRangePreset)
    const signature = buildPeopleRelationshipsSignature(this.deps.adapter, timeRangePreset)
    this.ensureTaskStarted(signature, timeRangePreset)
    return this.toGraphResponse(signature, { ...options, acceptStale: true, timeRangePreset })
  }

  invalidateRelationshipsCache(): void {
    this.snapshots.clear()
  }

  async close(): Promise<void> {
    const inFlight = this.inFlight
    if (!inFlight) return
    this.inFlight = null
    inFlight.abortController.abort()
    this.task = {
      ...this.task,
      status: 'failed',
      finishedAt: this.now(),
      lastError: 'people relationships task aborted',
    }
  }

  replaceSnapshotForTests(snapshot: PeopleRelationshipsSnapshot): void {
    this.snapshots.set(snapshot.timeRange.preset, snapshot)
  }

  private shouldStartTaskFromRead(
    options: PeopleRelationshipsServiceOptions,
    cacheStatus: PeopleRelationshipsCacheState['status']
  ): boolean {
    if (options.forceRecompute) return true
    if (cacheStatus === 'fresh') return false
    return this.task.status !== 'failed'
  }

  private ensureTaskStarted(signature: string, timeRangePreset: ContactsTimeRangePreset): void {
    if (this.inFlight) return

    const taskId = `people_relationships_${this.now()}_${Math.random().toString(36).slice(2)}`
    this.task = {
      id: taskId,
      status: 'running',
      startedAt: this.now(),
      finishedAt: null,
      processedSessions: 0,
      totalSessions: this.deps.adapter.listSessionIds().length,
      timeRangePreset,
    }

    const abortController = new AbortController()
    const promise = this.runner({
      signature,
      timeRangePreset,
      signal: abortController.signal,
      onProgress: (progress) => {
        if (this.task.id !== taskId || this.task.status !== 'running') return
        this.task = {
          ...this.task,
          processedSessions: progress.processedSessions,
          totalSessions: progress.totalSessions,
          currentSessionId: progress.currentSessionId,
        }
      },
    })
    this.inFlight = { id: taskId, signature, promise, abortController }

    promise
      .then((snapshot) => this.handleTaskSuccess(taskId, signature, snapshot))
      .catch((error) => this.handleTaskFailure(taskId, error))
  }

  private handleTaskSuccess(taskId: string, inputSignature: string, snapshot: PeopleRelationshipsSnapshot): void {
    if (this.inFlight?.id !== taskId) return
    this.inFlight = null
    const latestSignature = buildPeopleRelationshipsSignature(this.deps.adapter, snapshot.timeRange.preset)
    const finishedAt = this.now()

    if (inputSignature !== latestSignature || snapshot.signature !== latestSignature) {
      this.task = {
        ...this.task,
        status: 'superseded',
        finishedAt,
      }
      appLogger.info('people-relationships', 'people relationships worker result discarded because signature changed', {
        inputSignature,
        latestSignature,
      })
      return
    }

    try {
      writePeopleRelationshipsSnapshot(this.snapshotDir, snapshot)
      this.snapshots.set(snapshot.timeRange.preset, snapshot)
      this.task = {
        ...this.task,
        status: 'succeeded',
        finishedAt,
        processedSessions: snapshot.workerStats.processedSessions,
        totalSessions: snapshot.workerStats.totalSessions,
        currentSessionId: undefined,
      }
      appLogger.info('people-relationships', 'people relationships worker snapshot persisted', {
        nodeCount: snapshot.nodes.length,
        edgeCount: snapshot.edges.length,
        durationMs: snapshot.workerStats.durationMs,
      })
    } catch (error) {
      this.handleTaskFailure(taskId, error)
    }
  }

  private handleTaskFailure(taskId: string, error: unknown): void {
    if (this.inFlight?.id === taskId) this.inFlight = null
    const message = error instanceof Error ? error.message : String(error)
    this.task = {
      ...this.task,
      status: 'failed',
      finishedAt: this.now(),
      lastError: message,
    }
    appLogger.error('people-relationships', 'people relationships worker failed', error)
  }

  private getCacheStatus(
    signature: string,
    timeRangePreset: ContactsTimeRangePreset
  ): PeopleRelationshipsCacheState['status'] {
    const snapshot = this.getSnapshot(timeRangePreset)
    if (!snapshot) return 'missing'
    return snapshot.signature === signature ? 'fresh' : 'stale'
  }

  private toGraphResponse(
    signature: string,
    options: PeopleRelationshipsServiceOptions = {}
  ): PeopleRelationshipsGraphResponse {
    const timeRangePreset = normalizePeopleRelationshipsTimeRangePreset(options.timeRangePreset)
    const graphScope = normalizePeopleRelationshipsGraphScope(options.graphScope)
    const snapshot = this.getSnapshot(timeRangePreset)
    const status = this.getCacheStatus(signature, timeRangePreset)
    const includeSnapshot = shouldIncludeSnapshot(status, options.acceptStale)
    const graph = includeSnapshot && snapshot ? buildGraphForScope(snapshot, graphScope) : emptyGraph()
    return {
      graph,
      searchResults: includeSnapshot && snapshot ? buildSearchResults(snapshot, options.query, graph) : [],
      diagnostics: includeSnapshot
        ? sanitizePeopleRelationshipsDiagnostics(snapshot?.diagnostics ?? createEmptyDiagnostics())
        : createEmptyDiagnostics(),
      algorithmVersion: includeSnapshot
        ? (snapshot?.algorithmVersion ?? PEOPLE_RELATIONSHIPS_ALGORITHM_VERSION)
        : PEOPLE_RELATIONSHIPS_ALGORITHM_VERSION,
      timeRange: snapshot?.timeRange ?? resolvePeopleRelationshipsTimeRange(timeRangePreset, null),
      cache: this.toCacheState(status, snapshot),
      task: this.task,
    }
  }

  private toCacheState(
    status: PeopleRelationshipsCacheState['status'],
    snapshot: PeopleRelationshipsSnapshot | null
  ): PeopleRelationshipsCacheState {
    return {
      status,
      computedAt: snapshot?.computedAt ?? null,
      signature: snapshot?.signature,
      staleReason: status === 'stale' ? 'signature_changed' : undefined,
    }
  }

  private getSnapshot(timeRangePreset: ContactsTimeRangePreset): PeopleRelationshipsSnapshot | null {
    if (!this.snapshots.has(timeRangePreset)) {
      this.snapshots.set(
        timeRangePreset,
        readPeopleRelationshipsSnapshot(this.snapshotDir, timeRangePreset, { now: this.deps.now })
      )
    }
    return this.snapshots.get(timeRangePreset) ?? null
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }
}

function shouldIncludeSnapshot(status: PeopleRelationshipsCacheState['status'], acceptStale?: boolean): boolean {
  return status === 'fresh' || (status === 'stale' && acceptStale === true)
}

function normalizePeopleRelationshipsGraphScope(
  scope: PeopleRelationshipsGraphScope | undefined
): PeopleRelationshipsGraphScope {
  return scope === 'close' ? 'close' : 'panorama'
}

function buildGraphForScope(
  snapshot: PeopleRelationshipsSnapshot,
  scope: PeopleRelationshipsGraphScope
): PeopleRelationshipsGraphData {
  if (scope === 'close') return buildCloseRelationshipsGraph(snapshot)
  return snapshot.graph
}

function buildCloseRelationshipsGraph(snapshot: PeopleRelationshipsSnapshot): PeopleRelationshipsGraphData {
  const selectedKeys = new Set<string>()
  for (const node of snapshot.nodes) {
    if (node.kind === 'owner' || node.pool === 'friend') selectedKeys.add(node.key)
  }

  const topGroupmates = snapshot.nodes
    .filter((node) => node.kind !== 'owner' && node.pool !== 'friend' && node.score > 0)
    .sort(compareCloseGroupmates)
    .slice(0, CLOSE_GRAPH_NON_FRIEND_LIMIT)
  for (const node of topGroupmates) selectedKeys.add(node.key)

  const nodes = snapshot.nodes.filter((node) => selectedKeys.has(node.key)).sort(compareNodes)
  const edges = snapshot.edges.filter((edge) => selectedKeys.has(edge.sourceKey) && selectedKeys.has(edge.targetKey))

  return {
    nodes,
    edges,
    communities: filterCommunitiesForNodes(snapshot.communities, nodes),
  }
}

function compareCloseGroupmates(
  a: PeopleRelationshipsSnapshot['nodes'][number],
  b: PeopleRelationshipsSnapshot['nodes'][number]
): number {
  return b.score - a.score || a.rank - b.rank || a.key.localeCompare(b.key)
}

function filterCommunitiesForNodes(
  communities: PeopleRelationshipCommunity[],
  nodes: PeopleRelationshipsGraphData['nodes']
): PeopleRelationshipCommunity[] {
  const communitySizes = new Map<string, number>()
  for (const node of nodes) communitySizes.set(node.communityId, (communitySizes.get(node.communityId) ?? 0) + 1)
  return communities
    .filter((community) => communitySizes.has(community.id))
    .map((community) => ({
      ...community,
      size: communitySizes.get(community.id) ?? community.size,
    }))
}

function buildSearchResults(
  snapshot: PeopleRelationshipsSnapshot,
  queryInput: string | undefined,
  graph: PeopleRelationshipsGraphData
): PeopleRelationshipsSearchResult[] {
  const query = queryInput?.trim().toLowerCase() ?? ''
  if (!query) return []
  const visibleKeys = new Set(graph.nodes.map((node) => node.key))
  return snapshot.nodes
    .filter((node) => node.searchText.includes(query))
    .sort(compareNodes)
    .slice(0, snapshot.limits.searchResultLimit)
    .map((node) => ({
      key: node.key,
      kind: node.kind,
      displayName: node.displayName,
      platform: node.platform,
      platformId: node.platformId,
      avatar: node.avatar,
      pool: node.pool,
      score: node.score,
      rank: node.rank,
      communityId: node.communityId,
      inCoreGraph: visibleKeys.has(node.key),
    }))
}

function emptyGraph(): PeopleRelationshipsGraphData {
  return { nodes: [], edges: [], communities: [] }
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

function sanitizePeopleRelationshipsDiagnostics(
  diagnostics: PeopleRelationshipsDiagnostics
): PeopleRelationshipsDiagnostics {
  return {
    processedPrivateSessions: diagnostics.processedPrivateSessions,
    processedGroupSessions: diagnostics.processedGroupSessions,
    skippedMissingOwnerSessions: diagnostics.skippedMissingOwnerSessions,
    skippedUnresolvedOwnerSessions: diagnostics.skippedUnresolvedOwnerSessions,
    skippedAmbiguousPrivateSessions: diagnostics.skippedAmbiguousPrivateSessions,
    skippedFailedSessions: diagnostics.skippedFailedSessions,
    totalNodes: diagnostics.totalNodes,
    totalEdges: diagnostics.totalEdges,
    panoramaIncludedGroupSessions: diagnostics.panoramaIncludedGroupSessions ?? 0,
    panoramaExcludedLowValueGroupSessions: diagnostics.panoramaExcludedLowValueGroupSessions ?? 0,
    panoramaIncludedGroupMembers: diagnostics.panoramaIncludedGroupMembers ?? 0,
    panoramaExcludedGroupMembers: diagnostics.panoramaExcludedGroupMembers ?? 0,
    panoramaCandidateNodes: diagnostics.panoramaCandidateNodes ?? 0,
    panoramaGroupInclusionReasons: diagnostics.panoramaGroupInclusionReasons ?? {},
    coreNodeCount: diagnostics.coreNodeCount,
    coreEdgeCount: diagnostics.coreEdgeCount,
    warnings: diagnostics.warnings,
  }
}

function createIdleTaskState(): PeopleRelationshipsTaskState {
  return {
    id: null,
    status: 'idle',
    startedAt: null,
    finishedAt: null,
    processedSessions: 0,
    totalSessions: 0,
  }
}

function requirePathProvider(deps: PeopleRelationshipsServiceDeps): PathProvider {
  if (!deps.pathProvider) {
    throw new Error('people relationships worker runner requires pathProvider')
  }
  return deps.pathProvider
}

function resolvePeopleRelationshipsSnapshotDir(deps: PeopleRelationshipsServiceDeps): string {
  if (deps.pathProvider) return getPeopleRelationshipsDir(deps.pathProvider.getUserDataDir())
  if (deps.systemDir) return deps.systemDir
  throw new Error('people relationships service requires systemDir or pathProvider')
}
