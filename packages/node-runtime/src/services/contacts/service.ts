import path from 'node:path'
import type { PathProvider } from '@openchatlab/core'
import type { ContactsCacheState, ContactsResponse, ContactsTaskState } from '@openchatlab/shared-types'
import type { RuntimeIdentity } from '../../data-dir-compat'
import { appLogger } from '../../logging/app-logger'
import type { SessionRuntimeAdapter } from '../adapters'
import {
  CONTACTS_ALGORITHM_VERSION,
  createEmptyContactsDiagnostics,
  type ContactsComputeProgress,
  type ContactsSnapshot,
} from './compute'
import { buildContactsSignature } from './signature'
import { cleanupContactsSnapshotTempFiles, readContactsSnapshot, writeContactsSnapshot } from './snapshot'
import { createContactsWorkerRunner } from './worker-runner'

const CONTACTS_SNAPSHOT_DIR_NAME = 'contacts'

export interface ContactsServiceOptions {
  forceRecompute?: boolean
  acceptStale?: boolean
}

export interface ContactsRunnerOptions {
  signature: string
  onProgress: (progress: ContactsComputeProgress) => void
  signal: AbortSignal
}

export type ContactsComputeRunner = (options: ContactsRunnerOptions) => Promise<ContactsSnapshot>

export interface ContactsServiceDeps {
  adapter: SessionRuntimeAdapter
  systemDir?: string
  pathProvider?: PathProvider
  runtimeIdentity?: RuntimeIdentity
  nativeBinding?: string
  workerEntryUrl?: string | URL
  runner?: ContactsComputeRunner
  now?: () => number
}

export interface ContactsService {
  getContacts(options?: ContactsServiceOptions): ContactsResponse
  startRecompute(): ContactsResponse
  invalidateContactsCache(): void
  close(): Promise<void>
  replaceSnapshotForTests?(snapshot: ContactsSnapshot): void
}

interface InFlightTask {
  id: string
  signature: string
  promise: Promise<ContactsSnapshot>
  abortController: AbortController
}

export function createContactsService(deps: ContactsServiceDeps): ContactsService {
  return new DefaultContactsService(deps)
}

class DefaultContactsService implements ContactsService {
  private snapshot: ContactsSnapshot | null
  private inFlight: InFlightTask | null = null
  private task: ContactsTaskState = createIdleTaskState()
  private readonly snapshotDir: string
  private readonly runner: ContactsComputeRunner

  constructor(private readonly deps: ContactsServiceDeps) {
    this.snapshotDir = resolveContactsSnapshotDir(deps)
    cleanupContactsSnapshotTempFiles(this.snapshotDir)
    this.snapshot = readContactsSnapshot(this.snapshotDir, { now: deps.now })
    this.runner =
      deps.runner ??
      createContactsWorkerRunner({
        pathProvider: requirePathProvider(deps),
        runtimeIdentity: deps.runtimeIdentity,
        nativeBinding: deps.nativeBinding,
        workerEntryUrl: deps.workerEntryUrl,
      })
  }

  getContacts(options: ContactsServiceOptions = {}): ContactsResponse {
    const signature = buildContactsSignature(this.deps.adapter)
    const cacheStatus = this.getCacheStatus(signature)
    if (this.shouldStartTaskFromRead(options, cacheStatus)) this.ensureTaskStarted(signature)
    return this.toResponse(signature, options)
  }

  startRecompute(): ContactsResponse {
    const signature = buildContactsSignature(this.deps.adapter)
    this.ensureTaskStarted(signature)
    return this.toResponse(signature, { acceptStale: true })
  }

  invalidateContactsCache(): void {
    this.snapshot = null
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
      lastError: 'contacts task aborted',
    }
  }

  replaceSnapshotForTests(snapshot: ContactsSnapshot): void {
    this.snapshot = snapshot
  }

  private shouldStartTaskFromRead(options: ContactsServiceOptions, cacheStatus: ContactsCacheState['status']): boolean {
    if (options.forceRecompute) return true
    if (cacheStatus === 'fresh') return false
    return this.task.status !== 'failed'
  }

  private ensureTaskStarted(signature: string): void {
    if (this.inFlight) return

    const taskId = `contacts_${this.now()}_${Math.random().toString(36).slice(2)}`
    this.task = {
      id: taskId,
      status: 'running',
      startedAt: this.now(),
      finishedAt: null,
      processedSessions: 0,
      totalSessions: this.deps.adapter.listSessionIds().length,
    }

    const abortController = new AbortController()
    const promise = this.runner({
      signature,
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

  private handleTaskSuccess(taskId: string, inputSignature: string, snapshot: ContactsSnapshot): void {
    if (this.inFlight?.id !== taskId) return
    this.inFlight = null
    const latestSignature = buildContactsSignature(this.deps.adapter)
    const finishedAt = this.now()

    if (inputSignature !== latestSignature || snapshot.signature !== latestSignature) {
      this.task = {
        ...this.task,
        status: 'superseded',
        finishedAt,
      }
      appLogger.info('contacts', 'contacts worker result discarded because signature changed', {
        inputSignature,
        latestSignature,
      })
      return
    }

    try {
      writeContactsSnapshot(this.snapshotDir, snapshot)
      this.snapshot = snapshot
      this.task = {
        ...this.task,
        status: 'succeeded',
        finishedAt,
        processedSessions: snapshot.workerStats.processedSessions,
        totalSessions: snapshot.workerStats.totalSessions,
        currentSessionId: undefined,
      }
      appLogger.info('contacts', 'contacts worker snapshot persisted', {
        contactCount: snapshot.contacts.length,
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
    appLogger.error('contacts', 'contacts worker failed', error)
  }

  private getCacheStatus(signature: string): ContactsCacheState['status'] {
    if (!this.snapshot) return 'missing'
    return this.snapshot.signature === signature ? 'fresh' : 'stale'
  }

  private toResponse(signature: string, options: ContactsServiceOptions = {}): ContactsResponse {
    const snapshot = this.snapshot
    const status = this.getCacheStatus(signature)
    const includeSnapshot = status === 'fresh' || (status === 'stale' && options.acceptStale === true)
    return {
      contacts: includeSnapshot ? (snapshot?.contacts ?? []) : [],
      diagnostics: includeSnapshot
        ? (snapshot?.diagnostics ?? createEmptyContactsDiagnostics())
        : createEmptyContactsDiagnostics(),
      algorithmVersion: includeSnapshot
        ? (snapshot?.algorithmVersion ?? CONTACTS_ALGORITHM_VERSION)
        : CONTACTS_ALGORITHM_VERSION,
      cache: {
        status,
        computedAt: snapshot?.computedAt ?? null,
        signature: snapshot?.signature,
        staleReason: status === 'stale' ? 'signature_changed' : undefined,
      },
      task: this.task,
    }
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }
}

function createIdleTaskState(): ContactsTaskState {
  return {
    id: null,
    status: 'idle',
    startedAt: null,
    finishedAt: null,
    processedSessions: 0,
    totalSessions: 0,
  }
}

function requirePathProvider(deps: ContactsServiceDeps): PathProvider {
  if (!deps.pathProvider) {
    throw new Error('contacts worker runner requires pathProvider')
  }
  return deps.pathProvider
}

function resolveContactsSnapshotDir(deps: ContactsServiceDeps): string {
  if (deps.pathProvider) return path.join(deps.pathProvider.getUserDataDir(), CONTACTS_SNAPSHOT_DIR_NAME)
  if (deps.systemDir) return deps.systemDir
  throw new Error('contacts service requires systemDir or pathProvider')
}
