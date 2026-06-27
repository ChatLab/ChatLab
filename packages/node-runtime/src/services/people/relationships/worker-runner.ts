import { existsSync } from 'node:fs'
import { Worker } from 'node:worker_threads'
import type { WorkerOptions } from 'node:worker_threads'
import type { PathProvider } from '@openchatlab/core'
import type { RuntimeIdentity } from '../../../data-dir-compat'
import { snapshotPathProvider } from '../../../semantic-index/static-path-provider'
import type { PeopleRelationshipsComputeProgress, PeopleRelationshipsSnapshot } from './compute'
import type { PeopleRelationshipsComputeRunner } from './service'

export interface PeopleRelationshipsWorkerRunnerOptions {
  pathProvider: PathProvider
  runtimeIdentity?: RuntimeIdentity
  nativeBinding?: string
  workerEntryUrl?: string | URL
}

interface PeopleRelationshipsWorkerMessage {
  type: 'progress' | 'success' | 'error'
  progress?: PeopleRelationshipsComputeProgress
  snapshot?: PeopleRelationshipsSnapshot
  error?: string
}

type ModuleWorkerOptions = WorkerOptions & { type: 'module' }
type EntryExists = (url: URL) => boolean

export function resolveDefaultPeopleRelationshipsWorkerEntryUrl(
  currentModuleUrl: string | URL = import.meta.url,
  entryExists: EntryExists = (url) => existsSync(url)
): URL {
  const moduleUrl = typeof currentModuleUrl === 'string' ? currentModuleUrl : currentModuleUrl.href
  if (moduleUrl.endsWith('.ts')) return new URL('./worker-entry.ts', moduleUrl)
  if (moduleUrl.endsWith('.mjs')) return new URL('./people-relationships-worker.mjs', moduleUrl)

  const siblingWorkerEntry = new URL('./worker-entry.js', moduleUrl)
  return entryExists(siblingWorkerEntry) ? siblingWorkerEntry : new URL('./people-relationships-worker.js', moduleUrl)
}

function normalizeWorkerEntryUrl(entryUrl?: string | URL): URL {
  if (!entryUrl) return resolveDefaultPeopleRelationshipsWorkerEntryUrl()
  return typeof entryUrl === 'string' ? new URL(entryUrl) : entryUrl
}

function createWorker(workerData: unknown, entryUrlInput?: string | URL): Worker {
  const entryUrl = normalizeWorkerEntryUrl(entryUrlInput)
  if (!entryUrl.href.endsWith('.ts')) return new Worker(entryUrl, { workerData })

  const bootstrap = `
    import { register } from 'tsx/esm/api';
    register();
    await import(${JSON.stringify(entryUrl.href)});
  `
  const options: ModuleWorkerOptions = {
    eval: true,
    type: 'module',
    workerData,
    execArgv: [],
  }
  return new Worker(bootstrap, options)
}

export function createPeopleRelationshipsWorkerRunner(
  options: PeopleRelationshipsWorkerRunnerOptions
): PeopleRelationshipsComputeRunner {
  return ({ signature, timeRangePreset, signal, onProgress }) =>
    new Promise<PeopleRelationshipsSnapshot>((resolve, reject) => {
      if (signal.aborted) {
        reject(createAbortError())
        return
      }

      const worker = createWorker(
        {
          paths: snapshotPathProvider(options.pathProvider),
          runtimeIdentity: options.runtimeIdentity,
          nativeBinding: options.nativeBinding,
          signature,
          timeRangePreset,
        },
        options.workerEntryUrl
      )
      let settled = false
      const abort = () => {
        if (settled) return
        settled = true
        void worker.terminate()
        reject(createAbortError())
      }
      signal.addEventListener('abort', abort, { once: true })

      worker.on('message', (message: PeopleRelationshipsWorkerMessage) => {
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
          reject(new Error(message.error ?? 'people relationships worker failed'))
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
        reject(new Error(`people relationships worker exited with code ${code}`))
      })
    })
}

function createAbortError(): Error {
  return new Error('people relationships worker aborted')
}
