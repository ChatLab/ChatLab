/**
 * 工具类 API - 网络、缓存、会话索引
 */
import { ipcRenderer } from 'electron'

// ==================== 类型定义 ====================

// Network API 类型
export type ProxyMode = 'off' | 'system' | 'manual'

export interface ProxyConfig {
  mode: ProxyMode // 代理模式：关闭、跟随系统、手动配置
  url: string // 仅 manual 模式使用
}

// ==================== Network API ====================

export const networkApi = {
  /**
   * 获取代理配置
   */
  getProxyConfig: (): Promise<ProxyConfig> => {
    return ipcRenderer.invoke('network:getProxyConfig')
  },

  /**
   * 保存代理配置
   */
  saveProxyConfig: (config: ProxyConfig): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('network:saveProxyConfig', config)
  },

  /**
   * 测试代理连接
   */
  testProxyConnection: (proxyUrl: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('network:testProxyConnection', proxyUrl)
  },
}

// ==================== Cache API ====================

/**
 * CacheApi — IPC-only subset
 *
 * Most cache operations (getInfo, clear, openDir, saveToDownloads, etc.)
 * have been migrated to HTTP shared routes (FetchCacheAdapter).
 * Only selectDataDir and setDataDir remain on IPC because they require
 * native Electron dialogs and app restart capabilities.
 */
export const cacheApi = {
  selectDataDir: (): Promise<{ success: boolean; path?: string; error?: string }> => {
    return ipcRenderer.invoke('cache:selectDataDir')
  },

  setDataDir: (
    path: string | null,
    migrate: boolean = true
  ): Promise<{ success: boolean; error?: string; from?: string; to?: string }> => {
    return ipcRenderer.invoke('cache:setDataDir', { path, migrate })
  },
}

// Session index API has been migrated to shared HTTP routes (FetchSessionIndexAdapter).
// All session:* IPC handlers have been removed.
