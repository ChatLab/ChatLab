/**
 * 数据库 Worker 线程
 * 在独立线程中执行数据库操作，避免阻塞主进程
 *
 * 本文件作为 Worker 入口，负责：
 * 1. 初始化数据库目录
 * 2. 接收主进程消息
 * 3. 分发到对应的查询模块
 * 4. 返回结果
 */

import { parentPort, workerData } from 'worker_threads'
import { initDbDir, closeDatabase, closeAllDatabases } from './core'
import {
  getAvailableYears,
  getMemberActivity,
  getHourlyActivity,
  getDailyActivity,
  getWeekdayActivity,
  getMonthlyActivity,
  getYearlyActivity,
  getMessageLengthDistribution,
  getMessageTypeDistribution,
  getTimeRange,
  getMemberNameHistory,
  getAllSessions,
  getSession,
  getCatchphraseAnalysis,
  getMentionAnalysis,
  getMentionGraph,
  getLaughAnalysis,
  getClusterGraph,
  searchMessages,
  getMessageContext,
  getRecentMessages,
  getAllRecentMessages,
  getConversationBetween,
  getMessagesBefore,
  getMessagesAfter,
  // 成员管理
  getMembers,
  getMembersPaginated,
  updateMemberAliases,
  deleteMember,
  // SQL 实验室
  executeRawSQL,
  getSchema,
  executePluginQuery,
  // 会话索引
  generateSessions,
  generateIncrementalSessions,
  clearSessions,
  hasSessionIndex,
  getSessionStats,
  updateSessionGapThreshold,
  getSessions,
  searchSessions,
  getSessionMessages,
  // 自定义筛选
  filterMessagesWithContext,
  getMultipleSessionsMessages,
  exportFilterResultToFile,
  // NLP 查询
  getWordFrequency,
  segmentText,
  getPosTags,
} from './query'
import { streamImport, streamParseFileInfo, analyzeIncrementalImport, incrementalImport } from './import'

// 初始化数据库目录
initDbDir(workerData.dbDir)

// ==================== 消息处理 ====================

interface WorkerMessage {
  id: string
  type: string
  payload: any
}

// 同步消息处理器
const syncHandlers: Record<string, (payload: any) => any> = {
  // 基础查询
  getAvailableYears: (p) => getAvailableYears(p.sessionId),
  getMemberActivity: (p) => getMemberActivity(p.sessionId, p.filter),
  getHourlyActivity: (p) => getHourlyActivity(p.sessionId, p.filter),
  getDailyActivity: (p) => getDailyActivity(p.sessionId, p.filter),
  getWeekdayActivity: (p) => getWeekdayActivity(p.sessionId, p.filter),
  getMonthlyActivity: (p) => getMonthlyActivity(p.sessionId, p.filter),
  getYearlyActivity: (p) => getYearlyActivity(p.sessionId, p.filter),
  getMessageLengthDistribution: (p) => getMessageLengthDistribution(p.sessionId, p.filter),
  getMessageTypeDistribution: (p) => getMessageTypeDistribution(p.sessionId, p.filter),
  getTimeRange: (p) => getTimeRange(p.sessionId),
  getMemberNameHistory: (p) => getMemberNameHistory(p.sessionId, p.memberId),

  // 会话管理
  getAllSessions: () => getAllSessions(),
  getSession: (p) => getSession(p.sessionId),
  closeDatabase: (p) => {
    closeDatabase(p.sessionId)
    return true
  },
  closeAll: () => {
    closeAllDatabases()
    return true
  },

  // 成员管理
  getMembers: (p) => getMembers(p.sessionId),
  getMembersPaginated: (p) => getMembersPaginated(p.sessionId, p.params),
  updateMemberAliases: (p) => updateMemberAliases(p.sessionId, p.memberId, p.aliases),
  deleteMember: (p) => deleteMember(p.sessionId, p.memberId),

  // 高级分析
  getCatchphraseAnalysis: (p) => getCatchphraseAnalysis(p.sessionId, p.filter),
  getMentionAnalysis: (p) => getMentionAnalysis(p.sessionId, p.filter),
  getMentionGraph: (p) => getMentionGraph(p.sessionId, p.filter),
  getLaughAnalysis: (p) => getLaughAnalysis(p.sessionId, p.filter, p.keywords),
  getClusterGraph: (p) => getClusterGraph(p.sessionId, p.filter, p.options),

  // AI 查询
  searchMessages: (p) => searchMessages(p.sessionId, p.keywords, p.filter, p.limit, p.offset, p.senderId),
  getMessageContext: (p) => getMessageContext(p.sessionId, p.messageIds, p.contextSize),
  getRecentMessages: (p) => getRecentMessages(p.sessionId, p.filter, p.limit),
  getAllRecentMessages: (p) => getAllRecentMessages(p.sessionId, p.filter, p.limit),
  getConversationBetween: (p) => getConversationBetween(p.sessionId, p.memberId1, p.memberId2, p.filter, p.limit),
  getMessagesBefore: (p) => getMessagesBefore(p.sessionId, p.beforeId, p.limit, p.filter, p.senderId, p.keywords),
  getMessagesAfter: (p) => getMessagesAfter(p.sessionId, p.afterId, p.limit, p.filter, p.senderId, p.keywords),

  // SQL 实验室
  executeRawSQL: (p) => executeRawSQL(p.sessionId, p.sql),
  getSchema: (p) => getSchema(p.sessionId),

  // 插件系统
  pluginQuery: (p) => executePluginQuery(p.sessionId, p.sql, p.params),
  pluginCompute: (p: { fnString: string; input: any }) => {
    const fn = new Function('return ' + p.fnString)()
    return fn(p.input)
  },

  // 会话索引
  generateSessions: (p) => generateSessions(p.sessionId, p.gapThreshold),
  generateIncrementalSessions: (p) => generateIncrementalSessions(p.sessionId, p.gapThreshold),
  clearSessions: (p) => clearSessions(p.sessionId),
  hasSessionIndex: (p) => hasSessionIndex(p.sessionId),
  getSessionStats: (p) => getSessionStats(p.sessionId),
  updateSessionGapThreshold: (p) => updateSessionGapThreshold(p.sessionId, p.gapThreshold),
  getSessions: (p) => getSessions(p.sessionId),
  searchSessions: (p) => searchSessions(p.sessionId, p.keywords, p.timeFilter, p.limit, p.previewCount),
  getSessionMessages: (p) => getSessionMessages(p.sessionId, p.chatSessionId, p.limit),

  // 自定义筛选（支持分页）
  filterMessagesWithContext: (p) =>
    filterMessagesWithContext(p.sessionId, p.keywords, p.timeFilter, p.senderIds, p.contextSize, p.page, p.pageSize),
  getMultipleSessionsMessages: (p) => getMultipleSessionsMessages(p.sessionId, p.chatSessionIds, p.page, p.pageSize),

  // NLP 查询
  getWordFrequency: (p) => getWordFrequency(p),
  segmentText: (p) => segmentText(p.text, p.locale, p.minLength),
  getPosTags: () => getPosTags(),
}

// 异步消息处理器（流式操作）
const asyncHandlers: Record<string, (payload: any, requestId: string) => Promise<any>> = {
  // 流式导入
  streamImport: (p, id) => streamImport(p.filePath, id, p.formatOptions),
  // 流式解析文件信息（用于合并预览）
  streamParseFileInfo: (p, id) => streamParseFileInfo(p.filePath, id),
  // 增量导入
  analyzeIncrementalImport: (p, id) => analyzeIncrementalImport(p.sessionId, p.filePath, id),
  incrementalImport: (p, id) => incrementalImport(p.sessionId, p.filePath, id),
  // 导出筛选结果到文件（支持进度报告）
  exportFilterResultToFile: async (p, id) => exportFilterResultToFile(p, id),
}

// 处理消息
parentPort?.on('message', async (message: WorkerMessage) => {
  const { id, type, payload } = message

  try {
    // 检查是否是异步处理器
    const asyncHandler = asyncHandlers[type]
    if (asyncHandler) {
      const result = await asyncHandler(payload, id)
      parentPort?.postMessage({ id, success: true, result })
      return
    }

    // 同步处理器
    const syncHandler = syncHandlers[type]
    if (!syncHandler) {
      throw new Error(`Unknown message type: ${type}`)
    }

    const result = syncHandler(payload)
    parentPort?.postMessage({ id, success: true, result })
  } catch (error) {
    parentPort?.postMessage({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
})

// 进程退出时关闭所有数据库连接
process.on('exit', () => {
  closeAllDatabases()
})
