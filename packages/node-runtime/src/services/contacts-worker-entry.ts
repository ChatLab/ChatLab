import { parentPort, workerData } from 'node:worker_threads'
import { DatabaseManager } from '../database-manager'
import type { RuntimeIdentity } from '../data-dir-compat'
import { initAppLogger } from '../logging/app-logger'
import { StaticPathProvider, type StaticPathProviderSnapshot } from '../semantic-index/static-path-provider'
import { createDatabaseManagerAdapter } from './adapters'
import { computeContactsSnapshot, type ContactsComputeProgress } from './contacts-compute'

interface ContactsWorkerStartupOptions {
  paths: StaticPathProviderSnapshot
  runtimeIdentity?: RuntimeIdentity
  nativeBinding?: string
  signature: string
}

async function main(): Promise<void> {
  if (!parentPort) throw new Error('contacts worker requires parentPort')
  const options = workerData as ContactsWorkerStartupOptions
  initAppLogger(options.paths.logsDir)
  const pathProvider = new StaticPathProvider(options.paths)
  const dbManager = new DatabaseManager(pathProvider, {
    nativeBinding: options.nativeBinding,
    runtime: options.runtimeIdentity,
    allowMissingRuntimeForTests: !options.runtimeIdentity,
  })
  const adapter = createDatabaseManagerAdapter(dbManager)
  const onProgress = (progress: ContactsComputeProgress) => parentPort?.postMessage({ type: 'progress', progress })
  const snapshot = computeContactsSnapshot({ adapter, signature: options.signature, onProgress })
  parentPort.postMessage({ type: 'success', snapshot })
}

main().catch((error) => {
  parentPort?.postMessage({
    type: 'error',
    error: error instanceof Error ? error.message : String(error),
  })
})
