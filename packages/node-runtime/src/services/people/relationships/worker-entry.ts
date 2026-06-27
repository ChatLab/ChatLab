import { parentPort, workerData } from 'node:worker_threads'
import type { ContactsTimeRangePreset } from '@openchatlab/shared-types'
import { DatabaseManager } from '../../../database-manager'
import type { RuntimeIdentity } from '../../../data-dir-compat'
import { initAppLogger } from '../../../logging/app-logger'
import { StaticPathProvider, type StaticPathProviderSnapshot } from '../../../semantic-index/static-path-provider'
import { createDatabaseManagerAdapter } from '../../adapters'
import { computePeopleRelationshipsSnapshot, type PeopleRelationshipsComputeProgress } from './compute'
import { getPeopleRelationshipsFactsCacheDir } from './paths'

interface PeopleRelationshipsWorkerStartupOptions {
  paths: StaticPathProviderSnapshot
  runtimeIdentity?: RuntimeIdentity
  nativeBinding?: string
  signature: string
  timeRangePreset?: ContactsTimeRangePreset
}

async function main(): Promise<void> {
  if (!parentPort) throw new Error('people relationships worker requires parentPort')
  const options = workerData as PeopleRelationshipsWorkerStartupOptions
  initAppLogger(options.paths.logsDir)
  const pathProvider = new StaticPathProvider(options.paths)
  const dbManager = new DatabaseManager(pathProvider, {
    nativeBinding: options.nativeBinding,
    runtime: options.runtimeIdentity,
    allowMissingRuntimeForTests: !options.runtimeIdentity,
  })
  const adapter = createDatabaseManagerAdapter(dbManager)
  const onProgress = (progress: PeopleRelationshipsComputeProgress) =>
    parentPort?.postMessage({ type: 'progress', progress })
  const snapshot = computePeopleRelationshipsSnapshot({
    adapter,
    signature: options.signature,
    timeRangePreset: options.timeRangePreset,
    factsCacheDir: getPeopleRelationshipsFactsCacheDir(pathProvider.getUserDataDir()),
    onProgress,
  })
  parentPort.postMessage({ type: 'success', snapshot })
}

main().catch((error) => {
  parentPort?.postMessage({
    type: 'error',
    error: error instanceof Error ? error.message : String(error),
  })
})
