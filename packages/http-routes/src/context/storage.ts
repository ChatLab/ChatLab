import type { DataDirSwitchResult, PendingDataDirCleanup, PendingDataDirMigration } from '@openchatlab/node-runtime'

/** Platform-specific storage and shell capabilities exposed through Web routes. */
export interface StorageRouteContext {
  openDirectory?: (dirPath: string) => Promise<void>
  showInFolder?: (filePath: string) => Promise<void>
  downloadsDir?: string
  defaultUserDataDir?: string
  isCustomDataDir?: boolean
  canSetDataDir?: boolean
  getPendingDataDirMigration?: () => PendingDataDirMigration | null
  getPendingDataDirCleanups?: () => PendingDataDirCleanup[]
  dismissPendingDataDirCleanupNotice?: (cleanupId: string) => boolean
  deletePendingDataDirCleanup?: (cleanupId: string) => { success: boolean; error?: string }
  setDataDir?: (dirPath: string | null, migrate?: boolean) => Promise<DataDirSwitchResult> | DataDirSwitchResult
}
