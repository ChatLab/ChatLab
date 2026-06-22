import { Worker } from 'node:worker_threads'
import type { WorkerOptions } from 'node:worker_threads'
import type { SemanticIndexWorkerTransport } from './worker-client'
import type { SemanticIndexWorkerStartupOptions } from './worker-runtime'

export interface SemanticIndexWorkerLike {
  postMessage(message: unknown): void
  terminate(): Promise<number>
  on(event: 'message', listener: (message: unknown) => void): this
  on(event: 'error', listener: (error: Error) => void): this
  on(event: 'exit', listener: (code: number) => void): this
}

export interface SemanticIndexWorkerThreadTransportOptions {
  startup: SemanticIndexWorkerStartupOptions
  workerFactory?: () => SemanticIndexWorkerLike
  workerEntryUrl?: string | URL
  closeTimeoutMs?: number
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

const DEFAULT_CLOSE_TIMEOUT_MS = 3_000

type ModuleWorkerOptions = WorkerOptions & { type: 'module' }

function defaultWorkerEntryUrl(): URL {
  return import.meta.url.endsWith('.ts')
    ? new URL('./worker-thread-entry.ts', import.meta.url)
    : new URL('./worker-thread-entry.js', import.meta.url)
}

function normalizeWorkerEntryUrl(entryUrl?: string | URL): URL {
  if (!entryUrl) return defaultWorkerEntryUrl()
  return typeof entryUrl === 'string' ? new URL(entryUrl) : entryUrl
}

function createDefaultWorker(
  startup: SemanticIndexWorkerStartupOptions,
  entryUrlInput?: string | URL
): SemanticIndexWorkerLike {
  const entryUrl = normalizeWorkerEntryUrl(entryUrlInput)
  if (!entryUrl.href.endsWith('.ts')) {
    return new Worker(entryUrl, { workerData: startup }) as SemanticIndexWorkerLike
  }

  const bootstrap = `
    import { register } from 'tsx/esm/api';
    register();
    await import(${JSON.stringify(entryUrl.href)});
  `
  const options: ModuleWorkerOptions = {
    eval: true,
    type: 'module',
    workerData: startup,
    execArgv: [],
  }
  return new Worker(bootstrap, options) as SemanticIndexWorkerLike
}

export class SemanticIndexWorkerThreadTransport implements SemanticIndexWorkerTransport {
  private worker: SemanticIndexWorkerLike
  private pending = new Map<string, PendingRequest>()
  private requestId = 0
  private readonly closeTimeoutMs: number

  constructor(options: SemanticIndexWorkerThreadTransportOptions) {
    this.closeTimeoutMs = options.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS
    this.worker = options.workerFactory?.() ?? createDefaultWorker(options.startup, options.workerEntryUrl)

    this.worker.on('message', (message) => this.handleMessage(message))
    this.worker.on('error', (error) => this.rejectAll(error))
    this.worker.on('exit', (code) => {
      if (code !== 0) this.rejectAll(new Error(`Semantic index worker exited with code ${code}`))
    })
  }

  request<T>(method: string, args: unknown[]): Promise<T> {
    const id = `si_${++this.requestId}`
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      this.worker.postMessage({ id, method, args })
    })
  }

  async close(): Promise<void> {
    await this.requestRuntimeClose()
    await this.worker.terminate()
    this.rejectAll(new Error('Semantic index worker closed'))
  }

  private async requestRuntimeClose(): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | null = null
    const timeoutPromise = new Promise<void>((resolve) => {
      timeout = setTimeout(resolve, this.closeTimeoutMs)
    })

    try {
      // 先让 worker 内的 service 正常 close，避免 SQLite/vector 资源被直接中断；超时后仍会 terminate。
      await Promise.race([this.request('__close', []).then(() => undefined), timeoutPromise])
    } catch {
      // Worker may already be gone; terminate below still clears local state.
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }

  private handleMessage(message: unknown): void {
    const payload = message as { id?: string; success?: boolean; result?: unknown; error?: string }
    if (!payload.id) return
    const pending = this.pending.get(payload.id)
    if (!pending) return
    this.pending.delete(payload.id)
    if (payload.success) pending.resolve(payload.result)
    else pending.reject(new Error(payload.error ?? 'Semantic index worker request failed'))
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending.entries()) {
      this.pending.delete(id)
      pending.reject(error)
    }
  }
}

export function createSemanticIndexWorkerThreadTransport(
  options: SemanticIndexWorkerThreadTransportOptions
): SemanticIndexWorkerThreadTransport {
  return new SemanticIndexWorkerThreadTransport(options)
}
