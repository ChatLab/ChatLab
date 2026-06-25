import path from 'node:path'
import type { PathProvider } from '@openchatlab/core'
import type { AuthProfile } from '@openchatlab/config'
import { resolveApiKey as defaultResolveApiKey } from '@openchatlab/config'
import type { SemanticIndexConfig, SemanticIndexConfigInput } from './config'
import { isKeylessSemanticIndexApiBaseUrl, SemanticIndexConfigStore } from './config'
import {
  SEMANTIC_INDEX_CONFIG_FILE,
  persistSemanticIndexConfig,
  resolveSemanticIndexApiKeySet,
  type SemanticIndexSessionStatus,
  type SemanticSearchResult,
  type SemanticSearchToolOptions,
  type SemanticSearchToolResult,
} from './service'
import type { SemanticIndexRuntime } from './runtime'
import type { RuntimeIdentity } from '../data-dir-compat'
import { snapshotPathProvider } from './static-path-provider'
import { createSemanticIndexWorkerThreadTransport } from './worker-thread-transport'

export interface SemanticIndexWorkerTransport {
  request<T>(method: string, args: unknown[]): Promise<T>
  close(): void | Promise<void>
}

type MaybePromise<T> = T | Promise<T>

export type SemanticIndexWorkerTransportFactory = (modelDownloadProxyUrl?: string) => SemanticIndexWorkerTransport

interface WorkerClientTimers {
  setTimeout(callback: () => void, ms: number): unknown
  clearTimeout(timer: unknown): void
}

export interface SemanticIndexWorkerClientOptions {
  configStore: SemanticIndexConfigStore
  transportFactory: SemanticIndexWorkerTransportFactory
  idleTimeoutMs?: number
  timers?: WorkerClientTimers
  getModelDownloadProxyUrl?: () => MaybePromise<string | undefined>
  resolveApiKey?: (provider: string, authProfile?: string) => string
  writeAuthProfile?: (name: string, profile: AuthProfile) => void
}

export interface SemanticIndexWorkerRuntimeClientOptions {
  pathProvider: PathProvider
  runtime: RuntimeIdentity
  nativeBinding?: string
  sqliteVecLoadablePath?: string
  workerEntryUrl?: string | URL
  idleTimeoutMs?: number
  getModelDownloadProxyUrl?: () => MaybePromise<string | undefined>
  resolveApiKey?: (provider: string, authProfile?: string) => string
  writeAuthProfile?: (name: string, profile: AuthProfile) => void
}

const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000

const defaultTimers: WorkerClientTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
}

export class SemanticIndexWorkerClient implements SemanticIndexRuntime {
  private transport: SemanticIndexWorkerTransport | null = null
  private pendingRequests = 0
  private idleTimer: unknown = null
  private activeBuildSessionIds = new Set<string>()
  private hasUnknownActiveBuild = false
  private activeModelDownloadProxyUrl: string | undefined
  private readonly configStore: SemanticIndexConfigStore
  private readonly transportFactory: SemanticIndexWorkerTransportFactory
  private readonly idleTimeoutMs: number
  private readonly timers: WorkerClientTimers
  private readonly getModelDownloadProxyUrl: () => MaybePromise<string | undefined>
  private readonly resolveApiKey: (provider: string, authProfile?: string) => string
  private readonly writeAuthProfile?: (name: string, profile: AuthProfile) => void

  constructor(options: SemanticIndexWorkerClientOptions) {
    this.configStore = options.configStore
    this.transportFactory = options.transportFactory
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
    this.timers = options.timers ?? defaultTimers
    this.getModelDownloadProxyUrl = options.getModelDownloadProxyUrl ?? (() => undefined)
    this.resolveApiKey = options.resolveApiKey ?? defaultResolveApiKey
    this.writeAuthProfile = options.writeAuthProfile
  }

  getConfig(): SemanticIndexConfig {
    return this.configStore.get()
  }

  async setConfig(config: SemanticIndexConfigInput, options?: { apiKey?: string }): Promise<SemanticIndexConfig> {
    const saved = persistSemanticIndexConfig(this.configStore, config, {
      apiKey: options?.apiKey,
      writeAuthProfile: this.writeAuthProfile,
    })
    if (!saved.enabled) this.clearActiveBuildTracking()
    // 本地模式且功能开启时，即使 worker 未运行也需启动它以触发 preload；
    // 其余情况（disabled / api 模式）无需唤醒 worker，直接返回本地保存结果。
    const needsWorker = saved.enabled && saved.mode === 'local' && this.configStore.isConfigured()
    if (!this.transport && !needsWorker) return saved
    if (needsWorker) await this.closeTransportForLocalModelProxyChangeIfNeeded()
    return await this.call<SemanticIndexConfig>('setConfig', [saved])
  }

  isConfigured(): boolean {
    return this.configStore.isConfigured()
  }

  hasApiKey(): boolean {
    return resolveSemanticIndexApiKeySet(this.configStore.get(), this.resolveApiKey)
  }

  async getModelStatus(): Promise<'idle' | 'downloading' | 'ready' | 'error'> {
    if (!this.transport) return 'idle'
    return this.call<'idle' | 'downloading' | 'ready' | 'error'>('getModelStatus', [])
  }

  enable(sessionId: string): Promise<void> {
    return this.call('enable', [sessionId])
  }

  remove(sessionId: string): Promise<void> {
    return this.call('remove', [sessionId])
  }

  async build(sessionId: string): Promise<void> {
    await this.closeTransportForLocalModelProxyChangeIfNeeded()
    this.activeBuildSessionIds.add(sessionId)
    try {
      await this.call('build', [sessionId])
    } catch (error) {
      this.activeBuildSessionIds.delete(sessionId)
      throw error
    }
  }

  pause(sessionId: string): Promise<void> {
    return this.call('pause', [sessionId])
  }

  cancel(sessionId: string): Promise<void> {
    return this.call('cancel', [sessionId])
  }

  async rebuild(sessionId: string): Promise<void> {
    await this.closeTransportForLocalModelProxyChangeIfNeeded()
    this.activeBuildSessionIds.add(sessionId)
    try {
      await this.call('rebuild', [sessionId])
    } catch (error) {
      this.activeBuildSessionIds.delete(sessionId)
      throw error
    }
  }

  async buildAllPending(): Promise<void> {
    await this.closeTransportForLocalModelProxyChangeIfNeeded()
    this.hasUnknownActiveBuild = true
    try {
      await this.call('buildAllPending', [])
    } catch (error) {
      this.hasUnknownActiveBuild = false
      throw error
    }
  }

  async listEnabledStatuses(): Promise<SemanticIndexSessionStatus[]> {
    const statuses = await this.callProbe<SemanticIndexSessionStatus[]>('listEnabledStatuses', [], [], {
      scheduleIdle: false,
    })
    this.updateActiveBuildFromCompleteSnapshot(statuses)
    this.scheduleIdleCloseIfNeeded()
    return statuses
  }

  async status(sessionId: string): Promise<SemanticIndexSessionStatus | null> {
    const status = await this.callProbe<SemanticIndexSessionStatus | null>('status', [sessionId], null, {
      scheduleIdle: false,
    })
    this.updateActiveBuildFromPartialSnapshot([sessionId], status ? [status] : [])
    this.scheduleIdleCloseIfNeeded()
    return status
  }

  async statusForSessions(sessionIds: string[]): Promise<SemanticIndexSessionStatus[]> {
    const statuses = await this.callProbe<SemanticIndexSessionStatus[]>('statusForSessions', [sessionIds], [], {
      scheduleIdle: false,
    })
    this.updateActiveBuildFromPartialSnapshot(sessionIds, statuses)
    this.scheduleIdleCloseIfNeeded()
    return statuses
  }

  async canSearch(sessionId: string): Promise<boolean> {
    if (!this.canRunFromLocalConfig()) return false
    return await this.callProbe<boolean>('canSearch', [sessionId], false)
  }

  async search(
    sessionId: string,
    query: string,
    options?: { finalTopK?: number; timeRangeMs?: { startTs?: number; endTs?: number } }
  ): Promise<SemanticSearchResult> {
    await this.closeTransportForLocalModelProxyChangeIfNeeded()
    return await this.call('search', [sessionId, query, options])
  }

  async searchForTool(
    sessionId: string,
    query: string,
    options?: SemanticSearchToolOptions
  ): Promise<SemanticSearchToolResult> {
    await this.closeTransportForLocalModelProxyChangeIfNeeded()
    return await this.call('searchForTool', [sessionId, query, options])
  }

  cleanupUnused(): Promise<{ cleaned: number }> {
    return this.call('cleanupUnused', [])
  }

  recover(): Promise<void> {
    return this.call('recover', [])
  }

  async close(): Promise<void> {
    this.clearIdleTimer()
    await this.closeTransport()
  }

  private async call<T>(method: string, args: unknown[], options?: { scheduleIdle?: boolean }): Promise<T> {
    const transport = await this.ensureTransport()
    this.pendingRequests++
    this.clearIdleTimer()
    try {
      return await transport.request<T>(method, args)
    } finally {
      this.pendingRequests--
      if (options?.scheduleIdle !== false) this.scheduleIdleCloseIfNeeded()
    }
  }

  private async callProbe<T>(
    method: string,
    args: unknown[],
    fallback: T,
    options?: { scheduleIdle?: boolean }
  ): Promise<T> {
    try {
      return await this.call<T>(method, args, options)
    } catch {
      await this.closeFailedProbeTransport()
      return fallback
    }
  }

  private async ensureTransport(): Promise<SemanticIndexWorkerTransport> {
    if (!this.transport) {
      const proxyUrl = await this.currentModelDownloadProxyUrl()
      if (!this.transport) {
        this.activeModelDownloadProxyUrl = proxyUrl
        this.transport = this.transportFactory(proxyUrl)
      }
    }
    return this.transport
  }

  private async currentModelDownloadProxyUrl(): Promise<string | undefined> {
    const proxyUrl = (await this.getModelDownloadProxyUrl())?.trim()
    return proxyUrl || undefined
  }

  private async closeTransportForLocalModelProxyChangeIfNeeded(): Promise<void> {
    if (!this.transport) return
    const config = this.configStore.get()
    if (!this.configStore.canRun() || config.mode !== 'local') return
    if (this.hasUnknownActiveBuild || this.activeBuildSessionIds.size > 0) return
    if ((await this.currentModelDownloadProxyUrl()) === this.activeModelDownloadProxyUrl) return
    await this.closeTransport()
  }

  private canRunFromLocalConfig(): boolean {
    const config = this.configStore.get()
    if (!this.configStore.canRun()) return false
    if (config.mode !== 'api') return true
    if (isKeylessSemanticIndexApiBaseUrl(config.api?.baseUrl)) return true
    return resolveSemanticIndexApiKeySet(config, this.resolveApiKey)
  }

  private updateActiveBuildFromCompleteSnapshot(statuses: SemanticIndexSessionStatus[]): void {
    this.hasUnknownActiveBuild = false
    this.activeBuildSessionIds = new Set(
      statuses.filter((status) => this.isActiveBuildStatus(status)).map((status) => status.sessionId)
    )
  }

  private updateActiveBuildFromPartialSnapshot(
    requestedSessionIds: string[],
    statuses: SemanticIndexSessionStatus[]
  ): void {
    const bySessionId = new Map(statuses.map((status) => [status.sessionId, status]))
    for (const sessionId of requestedSessionIds) {
      const status = bySessionId.get(sessionId)
      if (status && this.isActiveBuildStatus(status)) this.activeBuildSessionIds.add(sessionId)
      else this.activeBuildSessionIds.delete(sessionId)
    }
  }

  private isActiveBuildStatus(status: SemanticIndexSessionStatus): boolean {
    return status.running || status.queued || status.indexStatus === 'running'
  }

  private clearActiveBuildTracking(): void {
    this.hasUnknownActiveBuild = false
    this.activeBuildSessionIds.clear()
  }

  private scheduleIdleCloseIfNeeded(): void {
    if (
      !this.transport ||
      this.pendingRequests > 0 ||
      this.hasUnknownActiveBuild ||
      this.activeBuildSessionIds.size > 0
    )
      return
    this.clearIdleTimer()
    this.idleTimer = this.timers.setTimeout(() => {
      void this.closeTransport().catch((err) => {
        console.warn('[semantic-index] idle worker close failed:', err instanceof Error ? err.message : String(err))
      })
    }, this.idleTimeoutMs)
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      this.timers.clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  private async closeTransport(): Promise<void> {
    const transport = this.transport
    this.transport = null
    this.activeModelDownloadProxyUrl = undefined
    this.clearActiveBuildTracking()
    if (transport) await transport.close()
  }

  private async closeFailedProbeTransport(): Promise<void> {
    this.clearIdleTimer()
    try {
      await this.closeTransport()
    } catch {
      // 语义索引探针失败只降级为不可用，不能打断普通 AI 对话流程。
    }
  }
}

export function createSemanticIndexWorkerClient(options: SemanticIndexWorkerClientOptions): SemanticIndexWorkerClient {
  return new SemanticIndexWorkerClient(options)
}

export function createSemanticIndexWorkerRuntimeClient(
  options: SemanticIndexWorkerRuntimeClientOptions
): SemanticIndexWorkerClient {
  const configStore = new SemanticIndexConfigStore(
    path.join(options.pathProvider.getAiDataDir(), SEMANTIC_INDEX_CONFIG_FILE)
  )
  return createSemanticIndexWorkerClient({
    configStore,
    idleTimeoutMs: options.idleTimeoutMs,
    resolveApiKey: options.resolveApiKey,
    writeAuthProfile: options.writeAuthProfile,
    getModelDownloadProxyUrl: options.getModelDownloadProxyUrl,
    transportFactory: (modelDownloadProxyUrl) =>
      createSemanticIndexWorkerThreadTransport({
        workerEntryUrl: options.workerEntryUrl,
        startup: {
          paths: snapshotPathProvider(options.pathProvider),
          runtime: options.runtime,
          nativeBinding: options.nativeBinding,
          sqliteVecLoadablePath: options.sqliteVecLoadablePath,
          modelDownloadProxyUrl,
        },
      }),
  })
}
