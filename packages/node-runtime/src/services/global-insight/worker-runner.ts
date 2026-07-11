import { existsSync } from 'node:fs'
import { Worker, type WorkerOptions } from 'node:worker_threads'
import type { PathProvider } from '@openchatlab/core'
import type { AnnualSummaryRange } from '@openchatlab/shared-types'
import type { RuntimeIdentity } from '../../data-dir-compat'
import { snapshotPathProvider } from '../../semantic-index/static-path-provider'
import type { AnnualSummaryComputeProgress, AnnualSummarySnapshot } from './types'

type ModuleWorkerOptions = WorkerOptions & { type: 'module' }
type EntryExists = (url: URL) => boolean

export interface AnnualSummaryRunnerOptions {
  signature: string
  range: AnnualSummaryRange
  onProgress: (progress: AnnualSummaryComputeProgress) => void
  signal: AbortSignal
}

export type AnnualSummaryComputeRunner = (options: AnnualSummaryRunnerOptions) => Promise<AnnualSummarySnapshot>

export interface AnnualSummaryWorkerRunnerOptions {
  pathProvider: PathProvider
  runtimeIdentity?: RuntimeIdentity
  nativeBinding?: string
  workerEntryUrl?: string | URL
}

interface WorkerMessage {
  type: 'progress' | 'success' | 'error'
  progress?: AnnualSummaryComputeProgress
  snapshot?: AnnualSummarySnapshot
  error?: string
}

export function resolveDefaultAnnualSummaryWorkerEntryUrl(
  currentModuleUrl: string | URL = import.meta.url,
  entryExists: EntryExists = (url) => existsSync(url)
): URL {
  const moduleUrl = typeof currentModuleUrl === 'string' ? currentModuleUrl : currentModuleUrl.href
  if (moduleUrl.endsWith('.ts')) return new URL('./worker-entry.ts', moduleUrl)
  if (moduleUrl.endsWith('.mjs')) return new URL('./global-insight-worker.mjs', moduleUrl)
  const sibling = new URL('./worker-entry.js', moduleUrl)
  return entryExists(sibling) ? sibling : new URL('./global-insight-worker.js', moduleUrl)
}

export function createAnnualSummaryWorkerRunner(options: AnnualSummaryWorkerRunnerOptions): AnnualSummaryComputeRunner {
  return ({ signature, range, signal, onProgress }) =>
    new Promise<AnnualSummarySnapshot>((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('annual summary worker aborted'))
        return
      }
      const worker = createWorker(
        {
          paths: snapshotPathProvider(options.pathProvider),
          runtimeIdentity: options.runtimeIdentity,
          nativeBinding: options.nativeBinding,
          signature,
          range,
        },
        options.workerEntryUrl
      )
      let settled = false
      const abort = () => {
        if (settled) return
        settled = true
        void worker.terminate()
        reject(new Error('annual summary worker aborted'))
      }
      signal.addEventListener('abort', abort, { once: true })
      worker.on('message', (message: WorkerMessage) => {
        if (message.type === 'progress' && message.progress) {
          onProgress(message.progress)
          return
        }
        if (message.type === 'success' && message.snapshot) {
          settled = true
          signal.removeEventListener('abort', abort)
          resolve(message.snapshot)
          void worker.terminate()
          return
        }
        if (message.type === 'error') {
          settled = true
          signal.removeEventListener('abort', abort)
          reject(new Error(message.error ?? 'annual summary worker failed'))
          void worker.terminate()
        }
      })
      worker.on('error', (error) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', abort)
        reject(error)
      })
      worker.on('exit', (code) => {
        if (settled || code === 0) return
        settled = true
        signal.removeEventListener('abort', abort)
        reject(new Error(`annual summary worker exited with code ${code}`))
      })
    })
}

function createWorker(workerData: unknown, entryUrlInput?: string | URL): Worker {
  const entryUrl = entryUrlInput
    ? typeof entryUrlInput === 'string'
      ? new URL(entryUrlInput)
      : entryUrlInput
    : resolveDefaultAnnualSummaryWorkerEntryUrl()
  if (!entryUrl.href.endsWith('.ts')) return new Worker(entryUrl, { workerData })
  const bootstrap = `
    import { register } from 'tsx/esm/api';
    register();
    await import(${JSON.stringify(entryUrl.href)});
  `
  const workerOptions: ModuleWorkerOptions = { eval: true, type: 'module', workerData, execArgv: [] }
  return new Worker(bootstrap, workerOptions)
}
