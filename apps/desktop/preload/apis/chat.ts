/**
 * 聊天记录 Preload API — 导入、迁移、Demo、合并
 *
 * 数据查询/分析/成员管理/SQL/NLP/偏好设置已迁移到
 * Internal HTTP Server (FetchDataAdapter, FetchPreferencesAdapter 等)。
 */
import { ipcRenderer } from 'electron'
import type { ImportProgress } from '../../../../src/types/base'
import type { FileParseInfo, ConflictCheckResult, MergeParams, MergeResult } from '../../../../src/types/format'

export const chatApi = {
  // ==================== 数据库迁移 ====================

  checkMigration: (): Promise<{
    needsMigration: boolean
    count: number
    currentVersion: number
    pendingMigrations: Array<{ version: number; userMessage: string }>
  }> => ipcRenderer.invoke('chat:checkMigration'),

  runMigration: (): Promise<{ success: boolean; migratedCount: number; error?: string }> =>
    ipcRenderer.invoke('chat:runMigration'),

  // ==================== 文件选择与导入 ====================

  selectFile: (): Promise<{ filePath?: string; format?: string; error?: string } | null> =>
    ipcRenderer.invoke('chat:selectFile'),

  import: (filePath: string): Promise<{ success: boolean; sessionId?: string; error?: string }> =>
    ipcRenderer.invoke('chat:import', filePath),

  importDirectory: (dirPath: string): Promise<{ success: boolean; sessionId?: string; error?: string }> =>
    ipcRenderer.invoke('chat:importDirectory', dirPath),

  detectFormat: (
    filePath: string
  ): Promise<{ id: string; name: string; platform: string; multiChat: boolean } | null> =>
    ipcRenderer.invoke('chat:detectFormat', filePath),

  importWithOptions: (
    filePath: string,
    formatOptions: Record<string, unknown>
  ): Promise<{ success: boolean; sessionId?: string; error?: string }> =>
    ipcRenderer.invoke('chat:importWithOptions', filePath, formatOptions),

  scanMultiChatFile: (
    filePath: string
  ): Promise<{
    success: boolean
    chats: Array<{ index: number; name: string; type: string; id: number; messageCount: number }>
    error?: string
  }> => ipcRenderer.invoke('chat:scanMultiChatFile', filePath),

  getSupportedFormats: (): Promise<Array<{ id: string; name: string; platform: string; extensions: string[] }>> =>
    ipcRenderer.invoke('chat:getSupportedFormats'),

  onImportProgress: (callback: (progress: ImportProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: ImportProgress) => callback(progress)
    ipcRenderer.on('chat:importProgress', handler)
    return () => ipcRenderer.removeListener('chat:importProgress', handler)
  },

  // ==================== 增量导入 ====================

  analyzeIncrementalImport: (
    sessionId: string,
    filePath: string
  ): Promise<{
    newMessageCount: number
    duplicateCount: number
    totalInFile: number
    error?: string
    diagnosis?: { suggestion?: string }
  }> => ipcRenderer.invoke('chat:analyzeIncrementalImport', sessionId, filePath),

  incrementalImport: (
    sessionId: string,
    filePath: string
  ): Promise<{ success: boolean; newMessageCount: number; error?: string }> =>
    ipcRenderer.invoke('chat:incrementalImport', sessionId, filePath),

  // ==================== 临时导出（合并用） ====================

  exportSessionsToTempFiles: (
    sessionIds: string[]
  ): Promise<{ success: boolean; tempFiles: string[]; error?: string }> =>
    ipcRenderer.invoke('chat:exportSessionsToTempFiles', sessionIds),

  cleanupTempExportFiles: (filePaths: string[]): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('chat:cleanupTempExportFiles', filePaths),

  // ==================== Demo ====================

  importDemo: (
    locale: string
  ): Promise<{ success: boolean; groupSessionId?: string; privateSessionIds?: string[]; error?: string }> =>
    ipcRenderer.invoke('demo:downloadAndImport', locale),

  onDemoProgress: (
    callback: (progress: { stage: string; current: number; total: number; message?: string }) => void
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      progress: { stage: string; current: number; total: number; message?: string }
    ) => callback(progress)
    ipcRenderer.on('demo:progress', handler)
    return () => ipcRenderer.removeListener('demo:progress', handler)
  },
}

// Merge API
export const mergeApi = {
  parseFileInfo: (filePath: string): Promise<FileParseInfo> => ipcRenderer.invoke('merge:parseFileInfo', filePath),
  checkConflicts: (filePaths: string[]): Promise<ConflictCheckResult> =>
    ipcRenderer.invoke('merge:checkConflicts', filePaths),
  mergeFiles: (params: MergeParams): Promise<MergeResult> => ipcRenderer.invoke('merge:mergeFiles', params),
  clearCache: (filePath?: string): Promise<boolean> => ipcRenderer.invoke('merge:clearCache', filePath),
}
