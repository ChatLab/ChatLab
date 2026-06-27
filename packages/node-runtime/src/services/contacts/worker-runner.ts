import { Worker } from 'node:worker_threads'
import type { WorkerOptions } from 'node:worker_threads'
import { existsSync } from 'node:fs'
import type { PathProvider } from '@openchatlab/core'
import type { RuntimeIdentity } from '../../data-dir-compat'
import { snapshotPathProvider } from '../../semantic-index/static-path-provider'
import type { ContactsComputeProgress, ContactsSnapshot } from './compute'
import type { ContactsComputeRunner } from './service'

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
type EntryExists = (url: URL) => boolean

export function resolveDefaultContactsWorkerEntryUrl(
  currentModuleUrl: string | URL = import.meta.url,
  entryExists: EntryExists = (url) => existsSync(url)
): URL {
  const moduleUrl = typeof currentModuleUrl === 'string' ? currentModuleUrl : currentModuleUrl.href
  if (moduleUrl.endsWith('.ts')) return new URL('./worker-entry.ts', moduleUrl)
  if (moduleUrl.endsWith('.mjs')) return new URL('./contacts-worker.mjs', moduleUrl)

  const siblingWorkerEntry = new URL('./worker-entry.js', moduleUrl)
  return entryExists(siblingWorkerEntry) ? siblingWorkerEntry : new URL('./contacts-worker.js', moduleUrl)
}

function normalizeWorkerEntryUrl(entryUrl?: string | URL): URL {
  if (!entryUrl) return resolveDefaultContactsWorkerEntryUrl()
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
  return ({ signature, signal, onProgress }) =>
    new Promise<ContactsSnapshot>((resolve, reject) => {
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

      worker.on('message', (message: ContactsWorkerMessage) => {
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
          reject(new Error(message.error ?? 'contacts worker failed'))
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
        reject(new Error(`contacts worker exited with code ${code}`))
      })
    })
}

function createAbortError(): Error {
  return new Error('contacts worker aborted')
}
