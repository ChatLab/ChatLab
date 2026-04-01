/**
 * 聊天记录 API - 导入、分析、管理聊天记录
 */
import { ipcRenderer } from 'electron'
import type { AnalysisSession, MessageType, ImportProgress } from '../../../src/types/base'
import type {
  MemberActivity,
  MemberNameHistory,
  HourlyActivity,
  DailyActivity,
  WeekdayActivity,
  MonthlyActivity,
  CatchphraseAnalysis,
  MentionAnalysis,
  LaughAnalysis,
  MemberWithStats,
  ClusterGraphData,
  ClusterGraphOptions,
} from '../../../src/types/analysis'
import type { FileParseInfo, ConflictCheckResult, MergeParams, MergeResult } from '../../../src/types/format'

// Chat Analysis API
export const chatApi = {
  // ==================== 数据库迁移 ====================

  /**
   * 检查是否需要数据库迁移
   */
  checkMigration: (): Promise<{
    needsMigration: boolean
    count: number
    currentVersion: number
    pendingMigrations: Array<{ version: number; userMessage: string }>
  }> => {
    return ipcRenderer.invoke('chat:checkMigration')
  },

  /**
   * 执行数据库迁移
   */
  runMigration: (): Promise<{ success: boolean; migratedCount: number; error?: string }> => {
    return ipcRenderer.invoke('chat:runMigration')
  },

  // ==================== 聊天记录导入与分析 ====================

  /**
   * 选择聊天记录文件
   */
  selectFile: (): Promise<{ filePath?: string; format?: string; error?: string } | null> => {
    return ipcRenderer.invoke('chat:selectFile')
  },

  /**
   * 导入聊天记录
   */
  import: (filePath: string): Promise<{ success: boolean; sessionId?: string; error?: string }> => {
    return ipcRenderer.invoke('chat:import', filePath)
  },

  /**
   * 检测文件格式（轻量级）
   */
  detectFormat: (
    filePath: string
  ): Promise<{ id: string; name: string; platform: string; multiChat: boolean } | null> => {
    return ipcRenderer.invoke('chat:detectFormat', filePath)
  },

  /**
   * 导入聊天记录（带格式选项）
   * 用于多聊天格式等需要额外参数的场景（如指定 chatIndex）
   */
  importWithOptions: (
    filePath: string,
    formatOptions: Record<string, unknown>
  ): Promise<{ success: boolean; sessionId?: string; error?: string }> => {
    return ipcRenderer.invoke('chat:importWithOptions', filePath, formatOptions)
  },

  /**
   * 扫描多聊天文件中的聊天列表（通用）
   * 自动检测格式并调用对应格式的 scanChats
   */
  scanMultiChatFile: (
    filePath: string
  ): Promise<{
    success: boolean
    chats: Array<{ index: number; name: string; type: string; id: number; messageCount: number }>
    error?: string
  }> => {
    return ipcRenderer.invoke('chat:scanMultiChatFile', filePath)
  },

  /**
   * 获取所有分析会话列表
   */
  getSessions: (): Promise<AnalysisSession[]> => {
    return ipcRenderer.invoke('chat:getSessions')
  },

  /**
   * 获取单个会话信息
   */
  getSession: (sessionId: string): Promise<AnalysisSession | null> => {
    return ipcRenderer.invoke('chat:getSession', sessionId)
  },

  /**
   * 删除会话
   */
  deleteSession: (sessionId: string): Promise<boolean> => {
    return ipcRenderer.invoke('chat:deleteSession', sessionId)
  },

  /**
   * 重命名会话
   */
  renameSession: (sessionId: string, newName: string): Promise<boolean> => {
    return ipcRenderer.invoke('chat:renameSession', sessionId, newName)
  },

  /**
   * 获取可用年份列表
   */
  getAvailableYears: (sessionId: string): Promise<number[]> => {
    return ipcRenderer.invoke('chat:getAvailableYears', sessionId)
  },

  /**
   * 获取成员活跃度排行
   */
  getMemberActivity: (sessionId: string, filter?: { startTs?: number; endTs?: number }): Promise<MemberActivity[]> => {
    return ipcRenderer.invoke('chat:getMemberActivity', sessionId, filter)
  },

  /**
   * 获取成员历史昵称
   */
  getMemberNameHistory: (sessionId: string, memberId: number): Promise<MemberNameHistory[]> => {
    return ipcRenderer.invoke('chat:getMemberNameHistory', sessionId, memberId)
  },

  /**
   * 获取每小时活跃度分布
   */
  getHourlyActivity: (sessionId: string, filter?: { startTs?: number; endTs?: number }): Promise<HourlyActivity[]> => {
    return ipcRenderer.invoke('chat:getHourlyActivity', sessionId, filter)
  },

  /**
   * 获取每日活跃度趋势
   */
  getDailyActivity: (sessionId: string, filter?: { startTs?: number; endTs?: number }): Promise<DailyActivity[]> => {
    return ipcRenderer.invoke('chat:getDailyActivity', sessionId, filter)
  },

  /**
   * 获取星期活跃度分布
   */
  getWeekdayActivity: (
    sessionId: string,
    filter?: { startTs?: number; endTs?: number }
  ): Promise<WeekdayActivity[]> => {
    return ipcRenderer.invoke('chat:getWeekdayActivity', sessionId, filter)
  },

  /**
   * 获取月份活跃度分布
   */
  getMonthlyActivity: (
    sessionId: string,
    filter?: { startTs?: number; endTs?: number }
  ): Promise<MonthlyActivity[]> => {
    return ipcRenderer.invoke('chat:getMonthlyActivity', sessionId, filter)
  },

  /**
   * 获取年份活跃度分布
   */
  getYearlyActivity: (
    sessionId: string,
    filter?: { startTs?: number; endTs?: number }
  ): Promise<Array<{ year: number; messageCount: number }>> => {
    return ipcRenderer.invoke('chat:getYearlyActivity', sessionId, filter)
  },

  /**
   * 获取消息长度分布
   */
  getMessageLengthDistribution: (
    sessionId: string,
    filter?: { startTs?: number; endTs?: number }
  ): Promise<{
    detail: Array<{ len: number; count: number }>
    grouped: Array<{ range: string; count: number }>
  }> => {
    return ipcRenderer.invoke('chat:getMessageLengthDistribution', sessionId, filter)
  },

  /**
   * 获取消息类型分布
   */
  getMessageTypeDistribution: (
    sessionId: string,
    filter?: { startTs?: number; endTs?: number }
  ): Promise<Array<{ type: MessageType; count: number }>> => {
    return ipcRenderer.invoke('chat:getMessageTypeDistribution', sessionId, filter)
  },

  /**
   * 获取时间范围
   */
  getTimeRange: (sessionId: string): Promise<{ start: number; end: number } | null> => {
    return ipcRenderer.invoke('chat:getTimeRange', sessionId)
  },

  /**
   * 获取数据库存储目录
   */
  getDbDirectory: (): Promise<string | null> => {
    return ipcRenderer.invoke('chat:getDbDirectory')
  },

  /**
   * 获取支持的格式列表
   */
  getSupportedFormats: (): Promise<Array<{ name: string; platform: string }>> => {
    return ipcRenderer.invoke('chat:getSupportedFormats')
  },

  /**
   * 监听导入进度
   */
  onImportProgress: (callback: (progress: ImportProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: ImportProgress) => {
      callback(progress)
    }
    ipcRenderer.on('chat:importProgress', handler)
    return () => {
      ipcRenderer.removeListener('chat:importProgress', handler)
    }
  },

  /**
   * 获取口头禅分析数据
   */
  getCatchphraseAnalysis: (
    sessionId: string,
    filter?: { startTs?: number; endTs?: number }
  ): Promise<CatchphraseAnalysis> => {
    return ipcRenderer.invoke('chat:getCatchphraseAnalysis', sessionId, filter)
  },

  /**
   * 获取 @ 互动分析数据
   */
  getMentionAnalysis: (sessionId: string, filter?: { startTs?: number; endTs?: number }): Promise<MentionAnalysis> => {
    return ipcRenderer.invoke('chat:getMentionAnalysis', sessionId, filter)
  },

  /**
   * 获取 @ 互动关系图数据
   */
  getMentionGraph: (
    sessionId: string,
    filter?: { startTs?: number; endTs?: number }
  ): Promise<{
    nodes: Array<{ id: number; name: string; value: number; symbolSize: number }>
    links: Array<{ source: string; target: string; value: number }>
    maxLinkValue: number
  }> => {
    return ipcRenderer.invoke('chat:getMentionGraph', sessionId, filter)
  },

  /**
   * 获取小团体关系图数据（基于时间相邻共现）
   */
  getClusterGraph: (
    sessionId: string,
    filter?: { startTs?: number; endTs?: number },
    options?: ClusterGraphOptions
  ): Promise<ClusterGraphData> => {
    return ipcRenderer.invoke('chat:getClusterGraph', sessionId, filter, options)
  },

  /**
   * 获取含笑量分析数据
   */
  getLaughAnalysis: (
    sessionId: string,
    filter?: { startTs?: number; endTs?: number },
    keywords?: string[]
  ): Promise<LaughAnalysis> => {
    return ipcRenderer.invoke('chat:getLaughAnalysis', sessionId, filter, keywords)
  },

  // ==================== 成员管理 ====================

  /**
   * 获取所有成员列表（含消息数和别名）
   */
  getMembers: (sessionId: string): Promise<MemberWithStats[]> => {
    return ipcRenderer.invoke('chat:getMembers', sessionId)
  },

  /**
   * 获取成员列表（分页版本）
   */
  getMembersPaginated: (
    sessionId: string,
    params: { page: number; pageSize: number; search?: string; sortOrder?: 'asc' | 'desc' }
  ): Promise<{
    members: MemberWithStats[]
    total: number
    page: number
    pageSize: number
    totalPages: number
  }> => {
    return ipcRenderer.invoke('chat:getMembersPaginated', sessionId, params)
  },

  /**
   * 更新成员别名
   */
  updateMemberAliases: (sessionId: string, memberId: number, aliases: string[]): Promise<boolean> => {
    return ipcRenderer.invoke('chat:updateMemberAliases', sessionId, memberId, aliases)
  },

  /**
   * 删除成员及其所有消息
   */
  deleteMember: (sessionId: string, memberId: number): Promise<boolean> => {
    return ipcRenderer.invoke('chat:deleteMember', sessionId, memberId)
  },

  /**
   * 更新会话的所有者（ownerId）
   * @param ownerId 成员的 platformId，设置为 null 则清除
   */
  updateSessionOwnerId: (sessionId: string, ownerId: string | null): Promise<boolean> => {
    return ipcRenderer.invoke('chat:updateSessionOwnerId', sessionId, ownerId)
  },

  // ==================== 插件系统 ====================

  /**
   * 插件参数化只读 SQL 查询
   */
  pluginQuery: <T = Record<string, any>>(sessionId: string, sql: string, params: any[] = []): Promise<T[]> => {
    return ipcRenderer.invoke('chat:pluginQuery', sessionId, sql, params)
  },

  /**
   * 插件计算卸载（纯函数在 Worker 中执行）
   */
  pluginCompute: <T = any>(fnString: string, input: any): Promise<T> => {
    return ipcRenderer.invoke('chat:pluginCompute', fnString, input)
  },

  // ==================== SQL 实验室 ====================

  /**
   * 执行用户 SQL 查询
   */
  executeSQL: (
    sessionId: string,
    sql: string
  ): Promise<{
    columns: string[]
    rows: any[][]
    rowCount: number
    duration: number
    limited: boolean
  }> => {
    return ipcRenderer.invoke('chat:executeSQL', sessionId, sql)
  },

  /**
   * 获取数据库 Schema
   */
  getSchema: (
    sessionId: string
  ): Promise<
    Array<{
      name: string
      columns: Array<{
        name: string
        type: string
        notnull: boolean
        pk: boolean
      }>
    }>
  > => {
    return ipcRenderer.invoke('chat:getSchema', sessionId)
  },

  // ==================== 增量导入 ====================

  /**
   * 分析增量导入（检测去重后能新增多少消息）
   */
  analyzeIncrementalImport: (
    sessionId: string,
    filePath: string
  ): Promise<{
    newMessageCount: number
    duplicateCount: number
    totalInFile: number
    error?: string
    diagnosis?: { suggestion?: string }
  }> => {
    return ipcRenderer.invoke('chat:analyzeIncrementalImport', sessionId, filePath)
  },

  /**
   * 执行增量导入
   */
  incrementalImport: (
    sessionId: string,
    filePath: string
  ): Promise<{
    success: boolean
    newMessageCount: number
    error?: string
  }> => {
    return ipcRenderer.invoke('chat:incrementalImport', sessionId, filePath)
  },

  /**
   * 导出多个会话为临时文件（用于批量管理中的合并）
   */
  exportSessionsToTempFiles: (
    sessionIds: string[]
  ): Promise<{
    success: boolean
    tempFiles: string[]
    error?: string
  }> => {
    return ipcRenderer.invoke('chat:exportSessionsToTempFiles', sessionIds)
  },

  /**
   * 清理临时导出文件
   */
  cleanupTempExportFiles: (
    filePaths: string[]
  ): Promise<{
    success: boolean
    error?: string
  }> => {
    return ipcRenderer.invoke('chat:cleanupTempExportFiles', filePaths)
  },
}

// Merge API - 合并功能
export const mergeApi = {
  /**
   * 解析文件获取基本信息（用于合并预览）
   * 解析后结果会被缓存，后续合并时无需再次读取原始文件
   */
  parseFileInfo: (filePath: string): Promise<FileParseInfo> => {
    return ipcRenderer.invoke('merge:parseFileInfo', filePath)
  },

  /**
   * 检测合并冲突
   */
  checkConflicts: (filePaths: string[]): Promise<ConflictCheckResult> => {
    return ipcRenderer.invoke('merge:checkConflicts', filePaths)
  },

  /**
   * 执行合并
   */
  mergeFiles: (params: MergeParams): Promise<MergeResult> => {
    return ipcRenderer.invoke('merge:mergeFiles', params)
  },

  /**
   * 清理解析缓存
   * @param filePath 可选，指定文件路径则清理该文件的缓存，否则清理所有缓存
   */
  clearCache: (filePath?: string): Promise<boolean> => {
    return ipcRenderer.invoke('merge:clearCache', filePath)
  },
}
