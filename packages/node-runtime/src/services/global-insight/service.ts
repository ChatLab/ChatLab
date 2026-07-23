import fs from 'node:fs'
import type { PathProvider } from '@openchatlab/core'
import type { AnnualSummaryRange, AnnualSummaryResponse, AnnualSummaryTaskState } from '@openchatlab/shared-types'
import type { RuntimeIdentity } from '../../data-dir-compat'
import { appLogger } from '../../logging/app-logger'
import type { SessionRuntimeAdapter } from '../adapters'
import { getGlobalInsightDir } from './paths'
import { buildAnnualSummarySignature } from './signature'
import {
  cleanupAnnualSummarySnapshotTempFiles,
  getAnnualSummarySnapshotPath,
  readAnnualSummarySnapshot,
  writeAnnualSummarySnapshot,
} from './snapshot'
import { normalizeAnnualSummaryRange, toAnnualSummaryRangeKey, type AnnualSummaryRangeInput } from './time-range'
import { createAnnualSummaryWorkerRunner, type AnnualSummaryComputeRunner } from './worker-runner'
import type { AnnualSummarySnapshot } from './types'

export interface GlobalInsightServiceOptions extends AnnualSummaryRangeInput {
  acceptStale?: boolean
  forceRecompute?: boolean
}

export interface GlobalInsightServiceDeps {
  adapter: SessionRuntimeAdapter
  pathProvider?: PathProvider
  userDataDir?: string
  runtimeIdentity?: RuntimeIdentity
  nativeBinding?: string
  workerEntryUrl?: string | URL
  runner?: AnnualSummaryComputeRunner
  now?: () => number
}

export interface GlobalInsightService {
  getAnnualSummary(options?: GlobalInsightServiceOptions): AnnualSummaryResponse
  startRecompute(options?: GlobalInsightServiceOptions): AnnualSummaryResponse
  invalidateCache(): void
  close(): Promise<void>
  normalizeRange(input?: AnnualSummaryRangeInput): AnnualSummaryRange
  replaceSnapshotForTests(snapshot: AnnualSummarySnapshot): void
}

interface InFlightTask {
  id: string
  signature: string
  promise: Promise<AnnualSummarySnapshot>
  abortController: AbortController
}

export function createGlobalInsightService(deps: GlobalInsightServiceDeps): GlobalInsightService {
  return new DefaultGlobalInsightService(deps)
}

class DefaultGlobalInsightService implements GlobalInsightService {
  private readonly snapshots = new Map<string, AnnualSummarySnapshot | null>()
  private readonly snapshotDir: string
  private readonly runner: AnnualSummaryComputeRunner
  private inFlight: InFlightTask | null = null
  private task: AnnualSummaryTaskState = createIdleTaskState()

  constructor(private readonly deps: GlobalInsightServiceDeps) {
    this.snapshotDir = deps.userDataDir
      ? getGlobalInsightDir(deps.userDataDir)
      : getGlobalInsightDir(requirePathProvider(deps).getUserDataDir())
    cleanupAnnualSummarySnapshotTempFiles(this.snapshotDir)
    this.runner =
      deps.runner ??
      createAnnualSummaryWorkerRunner({
        pathProvider: requirePathProvider(deps),
        runtimeIdentity: deps.runtimeIdentity,
        nativeBinding: deps.nativeBinding,
        workerEntryUrl: deps.workerEntryUrl,
      })
  }

  getAnnualSummary(options: GlobalInsightServiceOptions = {}): AnnualSummaryResponse {
    const range = this.normalizeRange(options)
    const signature = buildAnnualSummarySignature(this.deps.adapter, range)
    const status = this.getCacheStatus(signature, range)
    if (this.shouldStartTask(options, status)) this.ensureTaskStarted(signature, range)
    return this.toResponse(signature, range, options.acceptStale === true)
  }

  startRecompute(options: GlobalInsightServiceOptions = {}): AnnualSummaryResponse {
    const range = this.normalizeRange(options)
    const signature = buildAnnualSummarySignature(this.deps.adapter, range)
    this.ensureTaskStarted(signature, range)
    return this.toResponse(signature, range, true)
  }

  invalidateCache(): void {
    this.snapshots.clear()
  }

  normalizeRange(input: AnnualSummaryRangeInput = {}): AnnualSummaryRange {
    return normalizeAnnualSummaryRange(input, new Date(this.now()))
  }

  replaceSnapshotForTests(snapshot: AnnualSummarySnapshot): void {
    writeAnnualSummarySnapshot(this.snapshotDir, snapshot)
    this.snapshots.set(toAnnualSummaryRangeKey(snapshot.range), snapshot)
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
      lastError: 'annual summary task aborted',
    }
  }

  private shouldStartTask(
    options: GlobalInsightServiceOptions,
    status: AnnualSummaryResponse['cache']['status']
  ): boolean {
    if (options.forceRecompute) return true
    if (status === 'fresh') return false
    return this.task.status !== 'failed'
  }

  private ensureTaskStarted(signature: string, range: AnnualSummaryRange): void {
    if (this.inFlight) return
    const id = `annual_summary_${this.now()}_${Math.random().toString(36).slice(2)}`
    this.task = {
      id,
      status: 'running',
      startedAt: this.now(),
      finishedAt: null,
      processedSessions: 0,
      totalSessions: this.deps.adapter.listSessionIds().length,
    }
    const abortController = new AbortController()
    const promise = this.runner({
      signature,
      range,
      signal: abortController.signal,
      onProgress: (progress) => {
        if (this.task.id !== id || this.task.status !== 'running') return
        this.task = { ...this.task, ...progress }
      },
    })
    this.inFlight = { id, signature, promise, abortController }
    promise
      .then((snapshot) => this.handleTaskSuccess(id, signature, snapshot))
      .catch((error) => this.handleTaskFailure(id, error))
  }

  private handleTaskSuccess(id: string, inputSignature: string, snapshot: AnnualSummarySnapshot): void {
    if (this.inFlight?.id !== id) return
    const latestSignature = buildAnnualSummarySignature(this.deps.adapter, snapshot.range)
    const finishedAt = this.now()
    if (inputSignature !== latestSignature || snapshot.signature !== latestSignature) {
      this.inFlight = null
      this.task = { ...this.task, status: 'superseded', finishedAt, currentSessionId: undefined }
      appLogger.info('global-insight', 'annual summary worker result discarded because signature changed')
      return
    }
    try {
      writeAnnualSummarySnapshot(this.snapshotDir, snapshot)
      this.inFlight = null
      this.snapshots.set(toAnnualSummaryRangeKey(snapshot.range), snapshot)
      this.task = {
        ...this.task,
        status: 'succeeded',
        finishedAt,
        processedSessions: snapshot.workerStats.processedSessions,
        totalSessions: snapshot.workerStats.totalSessions,
        currentSessionId: undefined,
      }
      appLogger.info('global-insight', 'annual summary snapshot persisted', {
        analyzedSessions: snapshot.coverage.analyzedSessions,
        durationMs: snapshot.workerStats.durationMs,
      })
    } catch (error) {
      this.handleTaskFailure(id, error)
    }
  }

  private handleTaskFailure(id: string, error: unknown): void {
    if (this.inFlight?.id !== id) return
    this.inFlight = null
    this.task = {
      ...this.task,
      status: 'failed',
      finishedAt: this.now(),
      currentSessionId: undefined,
      lastError: error instanceof Error ? error.message : String(error),
    }
    appLogger.error('global-insight', 'annual summary worker failed', error)
  }

  private toResponse(signature: string, range: AnnualSummaryRange, acceptStale: boolean): AnnualSummaryResponse {
    const snapshot = this.getSnapshot(range)
    const status = this.getCacheStatus(signature, range)
    const includeSnapshot = status === 'fresh' || (status === 'stale' && acceptStale)
    return {
      range,
      availableDataYears: includeSnapshot ? (snapshot?.availableDataYears ?? []) : [],
      latestDataYear: includeSnapshot ? (snapshot?.latestDataYear ?? null) : null,
      metrics: includeSnapshot ? (snapshot?.metrics ?? null) : null,
      monthlyActivity: includeSnapshot ? (snapshot?.monthlyActivity ?? []) : [],
      monthlyDirectContacts: includeSnapshot ? (snapshot?.monthlyDirectContacts ?? []) : [],
      dailyActivity: includeSnapshot ? (snapshot?.dailyActivity ?? []) : [],
      messageTypes: includeSnapshot ? (snapshot?.messageTypes ?? []) : [],
      textLength: includeSnapshot ? (snapshot?.textLength ?? null) : null,
      coverage: includeSnapshot ? (snapshot?.coverage ?? emptyCoverage()) : emptyCoverage(),
      cache: {
        status,
        computedAt: snapshot?.computedAt ?? null,
        signature: snapshot?.signature,
        staleReason: status === 'stale' ? 'signature_changed' : undefined,
      },
      task: this.task,
    }
  }

  private getCacheStatus(signature: string, range: AnnualSummaryRange): AnnualSummaryResponse['cache']['status'] {
    const snapshot = this.getSnapshot(range)
    if (!snapshot) return 'missing'
    return snapshot.signature === signature ? 'fresh' : 'stale'
  }

  private getSnapshot(range: AnnualSummaryRange): AnnualSummarySnapshot | null {
    const key = toAnnualSummaryRangeKey(range)
    if (this.snapshots.has(key) && !fs.existsSync(getAnnualSummarySnapshotPath(this.snapshotDir, range))) {
      this.snapshots.delete(key)
    }
    if (!this.snapshots.has(key)) {
      this.snapshots.set(key, readAnnualSummarySnapshot(this.snapshotDir, range, { now: this.deps.now }))
    }
    return this.snapshots.get(key) ?? null
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }
}

function requirePathProvider(deps: GlobalInsightServiceDeps): PathProvider {
  if (!deps.pathProvider)
    throw new Error('GlobalInsightService requires pathProvider unless userDataDir and runner are provided')
  return deps.pathProvider
}

function createIdleTaskState(): AnnualSummaryTaskState {
  return {
    id: null,
    status: 'idle',
    startedAt: null,
    finishedAt: null,
    processedSessions: 0,
    totalSessions: 0,
  }
}

function emptyCoverage(): AnnualSummaryResponse['coverage'] {
  return {
    totalSessions: 0,
    analyzedSessions: 0,
    missingOwnerSessions: 0,
    unresolvedOwnerSessions: 0,
    failedSessions: 0,
  }
}
