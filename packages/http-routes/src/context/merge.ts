import type { DatabaseManager, MergeSessionCache } from '@openchatlab/node-runtime'

/** Optional merge capabilities. Routes are skipped when mergeSessionCache is absent. */
export interface MergeRouteContext {
  mergeSessionCache?: MergeSessionCache
  /** Platform-specific import function for the merge "andImport" flow. */
  streamImport?: (dbManager: DatabaseManager, filePath: string) => Promise<{ sessionId: string }>
}
