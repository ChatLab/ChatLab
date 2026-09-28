import type { DatabaseManager, MergeSessionCache } from '@openchatlab/node-runtime'

/** Optional merge capabilities. Routes are skipped when mergeSessionCache is absent. */
export interface MergeRouteContext {
  mergeSessionCache?: MergeSessionCache
  /** Platform-specific import function for the merge "andImport" flow. */
  streamImport?: (
    dbManager: DatabaseManager,
    filePath: string,
    options?: { sessionGapThreshold?: number }
  ) => Promise<{ sessionId: string }>
  /**
   * Called after a merged session has been imported, with the sessions it was merged from
   * (upload-based handles contribute no source session). Used to carry semantic index
   * vectors over to the new session; failures must not fail the merge.
   */
  onMergedSessionImported?: (params: { sessionId: string; sourceSessionIds: string[] }) => void | Promise<void>
}
