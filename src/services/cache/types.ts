export interface CacheDirectoryInfo {
  id: string
  name: string
  description: string
  path: string
  scope: 'user-data' | 'system-data'
  rootPath: string
  icon: string
  canClear: boolean
  size: number
  fileCount: number
  exists: boolean
}

export interface CacheInfo {
  baseDir: string
  directories: CacheDirectoryInfo[]
  totalSize: number
}

export interface DataDirInfo {
  path: string
  defaultPath?: string
  isCustom: boolean
  canSetDataDir?: boolean
  managedScope?: 'chat-databases'
  managedDescription?: string
  hasLegacyDataAtDefaultDir?: boolean
  pendingMigration?: {
    from: string
    to: string
    createdAt: string
  }
  pendingCleanups: DataDirCleanupInfo[]
}

export interface DataDirCleanupInfo {
  id: string
  sourceDir: string
  targetDir: string
  createdAt: string
  noticeDismissed: boolean
  exists: boolean
  size: number
}

export interface CacheServiceAdapter {
  getInfo(): Promise<CacheInfo>
  clear(cacheId: string): Promise<{ success: boolean; error?: string; message?: string }>
  getDataDir(): Promise<DataDirInfo>
  setDataDir(
    path: string | null,
    migrate?: boolean
  ): Promise<{ success: boolean; error?: string; from?: string; to?: string; requiresRelaunch?: boolean }>
  openDataDirCleanup(cleanupId: string): Promise<{ success: boolean; error?: string }>
  dismissDataDirCleanupNotice(cleanupId: string): Promise<{ success: boolean; error?: string }>
  deleteDataDirCleanup(cleanupId: string): Promise<{ success: boolean; error?: string }>
  getLatestImportLog(): Promise<{ success: boolean; path?: string; name?: string; error?: string }>
  saveToDownloads(filename: string, dataUrl: string): Promise<{ success: boolean; filePath?: string; error?: string }>
  openDir(cacheId: string): Promise<{ success: boolean; error?: string }>
  showInFolder(filePath: string): Promise<{ success: boolean; error?: string }>
}
