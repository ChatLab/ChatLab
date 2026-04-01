/**
 * 工具类 API - NLP、网络、缓存、会话索引
 */
import { ipcRenderer } from 'electron'

// ==================== 类型定义 ====================

// NLP API 类型
export interface WordFrequencyItem {
  word: string
  count: number
  percentage: number
}

export interface WordFrequencyResult {
  words: WordFrequencyItem[]
  totalWords: number
  totalMessages: number
  uniqueWords: number
}

export type PosFilterMode = 'all' | 'meaningful' | 'custom'

export interface WordFrequencyParams {
  sessionId: string
  locale: 'zh-CN' | 'en-US'
  timeFilter?: { startTs?: number; endTs?: number }
  memberId?: number
  topN?: number
  minWordLength?: number
  minCount?: number
  /** 词性过滤模式：all=全部, meaningful=只保留有意义的词, custom=自定义 */
  posFilterMode?: PosFilterMode
  /** 自定义词性过滤列表（posFilterMode='custom' 时使用） */
  customPosTags?: string[]
  /** 是否启用停用词过滤，默认 true */
  enableStopwords?: boolean
}

export interface PosTagInfo {
  tag: string
  name: string
  description: string
  meaningful: boolean
}

// Network API 类型
export type ProxyMode = 'off' | 'system' | 'manual'

export interface ProxyConfig {
  mode: ProxyMode // 代理模式：关闭、跟随系统、手动配置
  url: string // 仅 manual 模式使用
}

// Cache API 类型
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

// ==================== NLP API ====================

export const nlpApi = {
  /**
   * 获取词频统计（用于词云）
   */
  getWordFrequency: (params: WordFrequencyParams): Promise<WordFrequencyResult> => {
    return ipcRenderer.invoke('nlp:getWordFrequency', params)
  },

  /**
   * 单文本分词
   */
  segmentText: (text: string, locale: 'zh-CN' | 'en-US', minLength?: number): Promise<string[]> => {
    return ipcRenderer.invoke('nlp:segmentText', text, locale, minLength)
  },

  /**
   * 获取词性标签定义
   */
  getPosTags: (): Promise<PosTagInfo[]> => {
    return ipcRenderer.invoke('nlp:getPosTags')
  },
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

export const cacheApi = {
  /**
   * 获取所有缓存目录信息
   */
  getInfo: (): Promise<CacheInfo> => {
    return ipcRenderer.invoke('cache:getInfo')
  },

  /**
   * 清理指定缓存目录
   */
  clear: (cacheId: string): Promise<{ success: boolean; error?: string; message?: string }> => {
    return ipcRenderer.invoke('cache:clear', cacheId)
  },

  /**
   * 在文件管理器中打开缓存目录
   */
  openDir: (cacheId: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('cache:openDir', cacheId)
  },

  /**
   * 保存文件到下载目录
   */
  saveToDownloads: (
    filename: string,
    dataUrl: string
  ): Promise<{ success: boolean; filePath?: string; error?: string }> => {
    return ipcRenderer.invoke('cache:saveToDownloads', filename, dataUrl)
  },

  /**
   * 获取最新的导入日志文件路径
   */
  getLatestImportLog: (): Promise<{ success: boolean; path?: string; name?: string; error?: string }> => {
    return ipcRenderer.invoke('cache:getLatestImportLog')
  },

  /**
   * 获取当前数据目录
   */
  getDataDir: (): Promise<DataDirInfo> => {
    return ipcRenderer.invoke('cache:getDataDir')
  },

  /**
   * 选择数据目录（只返回路径）
   */
  selectDataDir: (): Promise<{ success: boolean; path?: string; error?: string }> => {
    return ipcRenderer.invoke('cache:selectDataDir')
  },

  /**
   * 设置数据目录
   */
  setDataDir: (
    path: string | null,
    migrate: boolean = true
  ): Promise<{ success: boolean; error?: string; from?: string; to?: string }> => {
    return ipcRenderer.invoke('cache:setDataDir', { path, migrate })
  },

  /**
   * 在文件管理器中显示并高亮文件
   */
  showInFolder: (filePath: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('cache:showInFolder', filePath)
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

  /**
   * 检查是否已生成会话索引
   */
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
    forceRegenerate?: boolean
  ): Promise<{ success: boolean; summary?: string; error?: string }> => {
    return ipcRenderer.invoke('session:generateSummary', dbSessionId, chatSessionId, locale, forceRegenerate)
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
