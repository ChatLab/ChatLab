import { parentPort, workerData } from 'node:worker_threads'
import type { AnnualSummaryRange } from '@openchatlab/shared-types'
import { DatabaseManager } from '../../database-manager'
import type { RuntimeIdentity } from '../../data-dir-compat'
import { initAppLogger } from '../../logging/app-logger'
import { StaticPathProvider, type StaticPathProviderSnapshot } from '../../semantic-index/static-path-provider'
import { createDatabaseManagerAdapter } from '../adapters'
import { computeAnnualSummarySnapshot, type ComputeAnnualSummarySnapshotOptions } from './compute'
import { getGlobalInsightFactsCacheDir } from './paths'

interface StartupOptions {
  paths: StaticPathProviderSnapshot
  runtimeIdentity?: RuntimeIdentity
  nativeBinding?: string
  signature: string
  range: AnnualSummaryRange
}

async function main(): Promise<void> {
  if (!parentPort) throw new Error('annual summary worker requires parentPort')
  const options = workerData as StartupOptions
  initAppLogger(options.paths.logsDir)
  const pathProvider = new StaticPathProvider(options.paths)
  const dbManager = new DatabaseManager(pathProvider, {
    nativeBinding: options.nativeBinding,
    runtime: options.runtimeIdentity,
    allowMissingRuntimeForTests: !options.runtimeIdentity,
  })
  const adapter = createDatabaseManagerAdapter(dbManager)
  const computeOptions: ComputeAnnualSummarySnapshotOptions = {
    adapter,
    signature: options.signature,
    range: options.range,
    factsCacheDir: getGlobalInsightFactsCacheDir(pathProvider.getUserDataDir()),
    onProgress: (progress) => parentPort?.postMessage({ type: 'progress', progress }),
  }
  const snapshot = computeAnnualSummarySnapshot(computeOptions)
  parentPort.postMessage({ type: 'success', snapshot })
}

main().catch((error) => {
  parentPort?.postMessage({ type: 'error', error: error instanceof Error ? error.message : String(error) })
})
