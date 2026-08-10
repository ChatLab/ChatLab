import fs from 'node:fs'
import type { PathProvider } from '@openchatlab/core'
import type { AnnualSummaryRange, AnnualSummaryTaskState, TimeInvestmentResponse } from '@openchatlab/shared-types'
import type { RuntimeIdentity } from '../../data-dir-compat'
import { appLogger } from '../../logging/app-logger'
import type { SessionRuntimeAdapter } from '../adapters'
import { getTimeInvestmentDir } from './paths'
import { normalizeAnnualSummaryRange, toAnnualSummaryRangeKey, type AnnualSummaryRangeInput } from './time-range'
import { buildTimeInvestmentSignature } from './time-investment-signature'
import {
  cleanupTimeInvestmentSnapshotTempFiles,
  getTimeInvestmentSnapshotPath,
  readTimeInvestmentSnapshot,
  writeTimeInvestmentSnapshot,
} from './time-investment-snapshot'
import type { TimeInvestmentSnapshot } from './time-investment-types'
import { createTimeInvestmentWorkerRunner, type TimeInvestmentComputeRunner } from './worker-runner'
import { listOwnerInsightSessionIds } from './session-scope'

export interface TimeInvestmentServiceOptions extends AnnualSummaryRangeInput {
  acceptStale?: boolean
}

export interface TimeInvestmentServiceDeps {
  adapter: SessionRuntimeAdapter
  pathProvider?: PathProvider
  userDataDir?: string
  runtimeIdentity?: RuntimeIdentity
  nativeBinding?: string
  workerEntryUrl?: string | URL
  runner?: TimeInvestmentComputeRunner
  getExcludedSessionIds?: () => readonly string[]
  now?: () => number
}

export interface TimeInvestmentService {
  getTimeInvestment(options?: TimeInvestmentServiceOptions): TimeInvestmentResponse
  startRecompute(options?: TimeInvestmentServiceOptions): TimeInvestmentResponse
  close(): Promise<void>
}

interface InFlightTask {
  id: string
  promise: Promise<TimeInvestmentSnapshot>
  abortController: AbortController
}

export function createTimeInvestmentService(deps: TimeInvestmentServiceDeps): TimeInvestmentService {
  return new DefaultTimeInvestmentService(deps)
}

class DefaultTimeInvestmentService implements TimeInvestmentService {
  private readonly snapshots = new Map<string, TimeInvestmentSnapshot | null>()
  private readonly snapshotDir: string
  private readonly runner: TimeInvestmentComputeRunner
  private inFlight: InFlightTask | null = null
  private task: AnnualSummaryTaskState = createIdleTaskState()

  constructor(private readonly deps: TimeInvestmentServiceDeps) {
    this.snapshotDir = deps.userDataDir
      ? getTimeInvestmentDir(deps.userDataDir)
      : getTimeInvestmentDir(requirePathProvider(deps).getUserDataDir())
    cleanupTimeInvestmentSnapshotTempFiles(this.snapshotDir)
    this.runner =
      deps.runner ??
      createTimeInvestmentWorkerRunner({
        pathProvider: requirePathProvider(deps),
        runtimeIdentity: deps.runtimeIdentity,
        nativeBinding: deps.nativeBinding,
        workerEntryUrl: deps.workerEntryUrl,
      })
  }

  getTimeInvestment(options: TimeInvestmentServiceOptions = {}): TimeInvestmentResponse {
    const range = this.normalizeRange(options)
    const excludedSessionIds = this.getExcludedSessionIds()
    const signature = buildTimeInvestmentSignature(this.deps.adapter, range, excludedSessionIds)
    const status = this.getCacheStatus(signature, range)
    if (this.shouldStartTask(status)) this.ensureTaskStarted(signature, range, excludedSessionIds)
    return this.toResponse(signature, range, options.acceptStale === true)
  }

  startRecompute(options: TimeInvestmentServiceOptions = {}): TimeInvestmentResponse {
    const range = this.normalizeRange(options)
    const excludedSessionIds = this.getExcludedSessionIds()
    const signature = buildTimeInvestmentSignature(this.deps.adapter, range, excludedSessionIds)
    this.ensureTaskStarted(signature, range, excludedSessionIds)
    return this.toResponse(signature, range, true)
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
      lastError: 'time investment task aborted',
    }
  }

  private shouldStartTask(status: TimeInvestmentResponse['cache']['status']): boolean {
    if (status === 'fresh') return false
    return this.task.status !== 'failed'
  }

  private normalizeRange(input: AnnualSummaryRangeInput = {}): AnnualSummaryRange {
    return normalizeAnnualSummaryRange(input, new Date(this.now()))
  }

  private ensureTaskStarted(signature: string, range: AnnualSummaryRange, excludedSessionIds: readonly string[]): void {
    if (this.inFlight) return
    const id = `time_investment_${this.now()}_${Math.random().toString(36).slice(2)}`
    this.task = {
      id,
      status: 'running',
      startedAt: this.now(),
      finishedAt: null,
      processedSessions: 0,
      totalSessions: listOwnerInsightSessionIds(this.deps.adapter, excludedSessionIds).length,
    }
    const abortController = new AbortController()
    const promise = this.runner({
      signature,
      range,
      excludedSessionIds,
      signal: abortController.signal,
      onProgress: (progress) => {
        if (this.task.id !== id || this.task.status !== 'running') return
        this.task = { ...this.task, ...progress }
      },
    })
    this.inFlight = { id, promise, abortController }
    promise
      .then((snapshot) => this.handleTaskSuccess(id, signature, snapshot))
      .catch((error) => this.handleTaskFailure(id, error))
  }

  private handleTaskSuccess(id: string, inputSignature: string, snapshot: TimeInvestmentSnapshot): void {
    if (this.inFlight?.id !== id) return
    const latestSignature = buildTimeInvestmentSignature(
      this.deps.adapter,
      snapshot.range,
      this.getExcludedSessionIds()
    )
    const finishedAt = this.now()
    if (inputSignature !== latestSignature || snapshot.signature !== latestSignature) {
      this.inFlight = null
      this.task = { ...this.task, status: 'superseded', finishedAt, currentSessionId: undefined }
      appLogger.info('global-insight', 'time investment worker result discarded because signature changed')
      return
    }
    try {
      writeTimeInvestmentSnapshot(this.snapshotDir, snapshot)
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
      appLogger.info('global-insight', 'time investment snapshot persisted', {
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
    appLogger.error('global-insight', 'time investment worker failed', error)
  }

  private toResponse(signature: string, range: AnnualSummaryRange, acceptStale: boolean): TimeInvestmentResponse {
    const snapshot = this.getSnapshot(range)
    const status = this.getCacheStatus(signature, range)
    const includeSnapshot = status === 'fresh' || (status === 'stale' && acceptStale)
    return {
      range,
      availableDataYears: includeSnapshot ? (snapshot?.availableDataYears ?? []) : [],
      latestDataYear: includeSnapshot ? (snapshot?.latestDataYear ?? null) : null,
      metrics: includeSnapshot ? (snapshot?.metrics ?? null) : null,
      monthlyActivity: includeSnapshot ? (snapshot?.monthlyActivity ?? []) : [],
      dailyActivity: includeSnapshot ? (snapshot?.dailyActivity ?? []) : [],
      sessionRanking: includeSnapshot ? (snapshot?.sessionRanking ?? []) : [],
      chatTypes: includeSnapshot ? (snapshot?.chatTypes ?? []) : [],
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

  private getCacheStatus(signature: string, range: AnnualSummaryRange): TimeInvestmentResponse['cache']['status'] {
    const snapshot = this.getSnapshot(range)
    if (!snapshot) return 'missing'
    return snapshot.signature === signature ? 'fresh' : 'stale'
  }

  private getSnapshot(range: AnnualSummaryRange): TimeInvestmentSnapshot | null {
    const key = toAnnualSummaryRangeKey(range)
    if (this.snapshots.has(key) && !fs.existsSync(getTimeInvestmentSnapshotPath(this.snapshotDir, range))) {
      this.snapshots.delete(key)
    }
    if (!this.snapshots.has(key)) {
      this.snapshots.set(key, readTimeInvestmentSnapshot(this.snapshotDir, range, { now: this.deps.now }))
    }
    return this.snapshots.get(key) ?? null
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  private getExcludedSessionIds(): readonly string[] {
    return this.deps.getExcludedSessionIds?.() ?? []
  }
}

function requirePathProvider(deps: TimeInvestmentServiceDeps): PathProvider {
  if (!deps.pathProvider)
    throw new Error('TimeInvestmentService requires pathProvider unless userDataDir and runner are provided')
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

function emptyCoverage(): TimeInvestmentResponse['coverage'] {
  return {
    totalSessions: 0,
    analyzedSessions: 0,
    missingOwnerSessions: 0,
    unresolvedOwnerSessions: 0,
    failedSessions: 0,
  }
}
