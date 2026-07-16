import type { DataDirSwitchResult, PendingDataDirMigration } from '@openchatlab/node-runtime'

/** Platform-specific storage and shell capabilities exposed through Web routes. */
export interface StorageRouteContext {
  openDirectory?: (dirPath: string) => Promise<void>
  showInFolder?: (filePath: string) => Promise<void>
  downloadsDir?: string
  defaultUserDataDir?: string
  isCustomDataDir?: boolean
  canSetDataDir?: boolean
  getPendingDataDirMigration?: () => PendingDataDirMigration | null
  setDataDir?: (dirPath: string | null, migrate?: boolean) => Promise<DataDirSwitchResult> | DataDirSwitchResult
}
