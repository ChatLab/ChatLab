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

// Session API 类型
export interface SessionStats {
  sessionCount: number
  hasIndex: boolean
  gapThreshold: number
}

export interface ChatSessionItem {
  id: number
  startTs: number
  endTs: number
  messageCount: number
  firstMessageId: number
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

// ==================== Session API ====================

export const sessionApi = {
  /**
   * 生成会话索引
   * @param sessionId 数据库会话ID
   * @param gapThreshold 时间间隔阈值（秒）
   * @returns 生成的会话数量
   */
  generate: (sessionId: string, gapThreshold?: number): Promise<number> => {
    return ipcRenderer.invoke('session:generate', sessionId, gapThreshold)
  },

  generateIncremental: (sessionId: string, gapThreshold?: number): Promise<number> => {
    return ipcRenderer.invoke('session:generateIncremental', sessionId, gapThreshold)
  },

  hasIndex: (sessionId: string): Promise<boolean> => {
    return ipcRenderer.invoke('session:hasIndex', sessionId)
  },

  /**
   * 获取会话索引统计信息
   */
  getStats: (sessionId: string): Promise<SessionStats> => {
    return ipcRenderer.invoke('session:getStats', sessionId)
  },

  /**
   * 批量获取所有会话的索引状态
   */
  getAllIndexStats: (): Promise<Array<{ sessionId: string; hasIndex: boolean; sessionCount: number }>> => {
    return ipcRenderer.invoke('session:getAllIndexStats')
  },

  /**
   * 清空会话索引
   */
  clear: (sessionId: string): Promise<boolean> => {
    return ipcRenderer.invoke('session:clear', sessionId)
  },

  /**
   * 更新会话切分阈值
   */
  updateGapThreshold: (sessionId: string, gapThreshold: number | null): Promise<boolean> => {
    return ipcRenderer.invoke('session:updateGapThreshold', sessionId, gapThreshold)
  },

  /**
   * 获取会话列表（用于时间线导航）
   */
  getSessions: (sessionId: string): Promise<ChatSessionItem[]> => {
    return ipcRenderer.invoke('session:getSessions', sessionId)
  },

  /**
   * 生成单个会话摘要
   */
  generateSummary: (
    dbSessionId: string,
    chatSessionId: number,
    locale?: string,
    forceRegenerate?: boolean,
    strategy?: 'brief' | 'standard'
  ): Promise<{ success: boolean; summary?: string; error?: string }> => {
    return ipcRenderer.invoke('session:generateSummary', dbSessionId, chatSessionId, locale, forceRegenerate, strategy)
  },

  /**
   * 批量生成会话摘要
   */
  generateSummaries: (
    dbSessionId: string,
    chatSessionIds: number[],
    locale?: string
  ): Promise<{ success: number; failed: number; skipped: number }> => {
    return ipcRenderer.invoke('session:generateSummaries', dbSessionId, chatSessionIds, locale)
  },

  /**
   * 批量检查会话是否可以生成摘要
   */
  checkCanGenerateSummary: (
    dbSessionId: string,
    chatSessionIds: number[]
  ): Promise<Record<number, { canGenerate: boolean; reason?: string }>> => {
    return ipcRenderer.invoke('session:checkCanGenerateSummary', dbSessionId, chatSessionIds)
  },

  /**
   * 根据时间范围查询会话列表
   */
  getByTimeRange: (
    dbSessionId: string,
    startTs: number,
    endTs: number
  ): Promise<
    Array<{
      id: number
      startTs: number
      endTs: number
      messageCount: number
      summary: string | null
    }>
  > => {
    return ipcRenderer.invoke('session:getByTimeRange', dbSessionId, startTs, endTs)
  },

  /**
   * 获取最近 N 条会话
   */
  getRecent: (
    dbSessionId: string,
    limit: number
  ): Promise<
    Array<{
      id: number
      startTs: number
      endTs: number
      messageCount: number
      summary: string | null
    }>
  > => {
    return ipcRenderer.invoke('session:getRecent', dbSessionId, limit)
  },
}
