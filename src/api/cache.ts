/**
 * Cache management API client — replaces window.cacheApi
 *
 * Maps preload IPC calls to HTTP endpoints under /api/cache.
 */

import { get, post, del } from './client'

// ─────────────────────────── types ───────────────────────────

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
  isCustom: boolean
}

// ─────────────────────────── cacheApi ───────────────────────────

export const cacheApi = {
  getInfo: () => get<CacheInfo>('/cache/info'),

  clear: (cacheId: string) =>
    del<{ success: boolean; error?: string; message?: string }>(`/cache/clear/${cacheId}`),

  /**
   * In the web app, we cannot open a folder in the user's file manager.
   * This is a no-op that returns success.
   */
  openDir: (_cacheId: string): Promise<{ success: boolean; error?: string }> =>
    Promise.resolve({ success: false, error: 'Not supported in web app' }),

  saveToDownloads: (filename: string, dataUrl: string) =>
    post<{ success: boolean; filePath?: string; error?: string }>('/cache/save-download', {
      filename,
      dataUrl,
    }),

  getLatestImportLog: () =>
    get<{ success: boolean; path?: string; name?: string; error?: string }>('/cache/import-log'),

  getDataDir: () => get<DataDirInfo>('/cache/data-dir'),

  /**
   * In the web app, file dialogs are handled by the browser.
   * This is a no-op placeholder.
   */
  selectDataDir: (): Promise<{ success: boolean; path?: string; error?: string }> =>
    Promise.resolve({ success: false, error: 'Use browser file picker' }),

  setDataDir: (path: string | null, migrate: boolean = true) =>
    post<{ success: boolean; error?: string; from?: string; to?: string }>('/cache/data-dir', {
      path,
      migrate,
    }),

  /**
   * In the web app, we cannot show a file in the OS file manager.
   */
  showInFolder: (_filePath: string): Promise<{ success: boolean; error?: string }> =>
    Promise.resolve({ success: false, error: 'Not supported in web app' }),
}
