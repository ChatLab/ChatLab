import { Worker } from 'node:worker_threads'
import type { WorkerOptions } from 'node:worker_threads'
import type { PathProvider } from '@openchatlab/core'
import type { RuntimeIdentity } from '../data-dir-compat'
import { snapshotPathProvider } from '../semantic-index/static-path-provider'
import type { ContactsComputeProgress, ContactsSnapshot } from './contacts-compute'
import type { ContactsComputeRunner } from './contacts-service'

export interface ContactsWorkerRunnerOptions {
  pathProvider: PathProvider
  runtimeIdentity?: RuntimeIdentity
  nativeBinding?: string
  workerEntryUrl?: string | URL
}

interface ContactsWorkerMessage {
  type: 'progress' | 'success' | 'error'
  progress?: ContactsComputeProgress
  snapshot?: ContactsSnapshot
  error?: string
}

type ModuleWorkerOptions = WorkerOptions & { type: 'module' }

function defaultWorkerEntryUrl(): URL {
  return import.meta.url.endsWith('.ts')
    ? new URL('./contacts-worker-entry.ts', import.meta.url)
    : new URL('./contacts-worker-entry.js', import.meta.url)
}

function normalizeWorkerEntryUrl(entryUrl?: string | URL): URL {
  if (!entryUrl) return defaultWorkerEntryUrl()
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

export function createContactsWorkerRunner(options: ContactsWorkerRunnerOptions): ContactsComputeRunner {
  return ({ signature, onProgress }) =>
    new Promise<ContactsSnapshot>((resolve, reject) => {
      const worker = createWorker(
        {
          paths: snapshotPathProvider(options.pathProvider),
          runtimeIdentity: options.runtimeIdentity,
          nativeBinding: options.nativeBinding,
          signature,
        },
        options.workerEntryUrl
      )
      let settled = false

      worker.on('message', (message: ContactsWorkerMessage) => {
        if (message.type === 'progress' && message.progress) {
          onProgress(message.progress)
          return
        }
        if (message.type === 'success' && message.snapshot) {
          settled = true
          resolve(message.snapshot)
          void worker.terminate()
          return
        }
        if (message.type === 'error') {
          settled = true
          reject(new Error(message.error ?? 'contacts worker failed'))
          void worker.terminate()
        }
      })
      worker.on('error', (error) => {
        if (settled) return
        settled = true
        reject(error)
      })
      worker.on('exit', (code) => {
        if (settled || code === 0) return
        settled = true
        reject(new Error(`contacts worker exited with code ${code}`))
      })
    })
}
