import type { CacheServiceAdapter, CacheInfo, DataDirInfo } from './types'
import { get, post } from '../utils/http'

export class FetchCacheAdapter implements CacheServiceAdapter {
  async getInfo(): Promise<CacheInfo> {
    return get<CacheInfo>('/cache/info')
  }

  async clear(cacheId: string): Promise<{ success: boolean; error?: string; message?: string }> {
    return post<{ success: boolean; error?: string; message?: string }>('/cache/clear', { cacheId })
  }

  async getDataDir(): Promise<DataDirInfo> {
    return get<DataDirInfo>('/cache/data-dir')
  }

  async setDataDir(
    path: string | null,
    migrate: boolean = true
  ): Promise<{ success: boolean; error?: string; from?: string; to?: string; requiresRelaunch?: boolean }> {
    return post<{ success: boolean; error?: string; from?: string; to?: string; requiresRelaunch?: boolean }>(
      '/cache/data-dir',
      {
        path,
        migrate,
      }
    )
  }

  async getLatestImportLog(): Promise<{ success: boolean; path?: string; name?: string; error?: string }> {
    return get<{ success: boolean; path?: string; name?: string; error?: string }>('/cache/latest-import-log')
  }

  async saveToDownloads(
    filename: string,
    dataUrl: string
  ): Promise<{ success: boolean; filePath?: string; error?: string }> {
    return post<{ success: boolean; filePath?: string; error?: string }>('/cache/save-to-downloads', {
      filename,
      dataUrl,
    })
  }

  async openDir(cacheId: string): Promise<{ success: boolean; error?: string }> {
    return post<{ success: boolean; error?: string }>('/cache/open-dir', { cacheId })
  }

  async showInFolder(filePath: string): Promise<{ success: boolean; error?: string }> {
    return post<{ success: boolean; error?: string }>('/cache/show-in-folder', { filePath })
  }
}
