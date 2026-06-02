export interface CacheDirectoryInfo {
  id: string
  name: string
  description: string
  path: string
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
  hasLegacyDataAtDefaultDir?: boolean
  pendingMigration?: {
    from: string
    to: string
    createdAt: string
  }
}

export interface CacheServiceAdapter {
  getInfo(): Promise<CacheInfo>
  clear(cacheId: string): Promise<{ success: boolean; error?: string; message?: string }>
  getDataDir(): Promise<DataDirInfo>
  setDataDir(
    path: string | null,
    migrate?: boolean
  ): Promise<{ success: boolean; error?: string; from?: string; to?: string; requiresRelaunch?: boolean }>
  getLatestImportLog(): Promise<{ success: boolean; path?: string; name?: string; error?: string }>
  saveToDownloads(filename: string, dataUrl: string): Promise<{ success: boolean; filePath?: string; error?: string }>
  openDir(cacheId: string): Promise<{ success: boolean; error?: string }>
  showInFolder(filePath: string): Promise<{ success: boolean; error?: string }>
}
