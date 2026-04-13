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

import * as path from 'path'
import { parentPort, workerData } from 'worker_threads'
import { initDbDir, closeDatabase, closeAllDatabases, getCacheDir } from './core'
import { getCache, setCache, deleteSessionCache } from '../database/sessionCache'
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
  getChatOverview,
  getCatchphraseAnalysis,
  getMentionAnalysis,
  getMentionGraph,
  getLaughAnalysis,
  getClusterGraph,
  getRelationshipStats,
  searchMessages,
  deepSearchMessages,
  getMessageContext,
  getSearchMessageContext,
  getRecentMessages,
  getAllRecentMessages,
  getConversationBetween,
  getMessagesBefore,
  getMessagesAfter,
  // 成员管理
  getMembers,
  getMembersPaginated,
  updateMemberAliases,
  mergeMembers,
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
import { initNlpDir } from '../nlp/segmenter'

// 初始化数据库目录
initDbDir(workerData.dbDir, workerData.cacheDir)

// 初始化 NLP 词库目录
if (workerData.nlpDir) {
  initNlpDir(workerData.nlpDir)
}

// ==================== 分析结果缓存 ====================

const ANALYSIS_CACHE_PREFIX = 'analysis:'

function getQueryCacheDir(): string {
  const cacheDir = getCacheDir()
  return cacheDir ? path.join(cacheDir, 'query') : ''
}

const CACHEABLE_QUERIES = new Set([
  'getAvailableYears',
  'getMemberActivity',
  'getHourlyActivity',
  'getDailyActivity',
  'getWeekdayActivity',
  'getMonthlyActivity',
  'getYearlyActivity',
  'getMessageLengthDistribution',
  'getMessageTypeDistribution',
  'getTimeRange',
  'getCatchphraseAnalysis',
  'getMentionAnalysis',
  'getMentionGraph',
  'getLaughAnalysis',
  'getClusterGraph',
  'getWordFrequency',
])

function buildAnalysisCacheKey(type: string, payload: any): string {
  const parts = [ANALYSIS_CACHE_PREFIX + type]
  // 标准 filter 对象（大多数分析查询）
  const filter = payload.filter || payload.timeFilter
  if (filter) {
    if (filter.startTs !== undefined) parts.push(`s${filter.startTs}`)
    if (filter.endTs !== undefined) parts.push(`e${filter.endTs}`)
    if (filter.memberId !== undefined && filter.memberId !== null) {
      parts.push(`m${filter.memberId}`)
    }
  }
  // 顶层 memberId（如 getWordFrequency 直接传 memberId）
  if (payload.memberId !== undefined && payload.memberId !== null) parts.push(`m${payload.memberId}`)
  if (payload.keywords) parts.push(`k${JSON.stringify(payload.keywords)}`)
  if (payload.options) parts.push(`o${JSON.stringify(payload.options)}`)
  // getWordFrequency 特有参数
  if (payload.locale) parts.push(`l${payload.locale}`)
  if (payload.topN) parts.push(`n${payload.topN}`)
  if (payload.minLength) parts.push(`ml${payload.minLength}`)
  if (payload.posFilterMode) parts.push(`pfm${payload.posFilterMode}`)
  if (payload.customPosTags?.length) parts.push(`cpt${JSON.stringify(payload.customPosTags)}`)
  if (payload.posTags) parts.push(`pt${JSON.stringify(payload.posTags)}`)
  if (payload.enableStopwords === false) parts.push('sw0')
  if (payload.dictType && payload.dictType !== 'default') parts.push(`dt${payload.dictType}`)
  if (payload.excludeWords?.length) parts.push(`ew${JSON.stringify(payload.excludeWords)}`)
  return parts.join(':')
}

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
  getChatOverview: (p) => getChatOverview(p.sessionId, p.topN),
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
  mergeMembers: (p) => mergeMembers(p.sessionId, p.memberId1, p.memberId2),
  deleteMember: (p) => deleteMember(p.sessionId, p.memberId),

  // 高级分析
  getCatchphraseAnalysis: (p) => getCatchphraseAnalysis(p.sessionId, p.filter),
  getMentionAnalysis: (p) => getMentionAnalysis(p.sessionId, p.filter),
  getMentionGraph: (p) => getMentionGraph(p.sessionId, p.filter),
  getLaughAnalysis: (p) => getLaughAnalysis(p.sessionId, p.filter, p.keywords),
  getClusterGraph: (p) => getClusterGraph(p.sessionId, p.filter, p.options),
  getRelationshipStats: (p) => getRelationshipStats(p.sessionId, p.filter, p.options),

  // AI 查询
  searchMessages: (p) => searchMessages(p.sessionId, p.keywords, p.filter, p.limit, p.offset, p.senderId),
  getMessageContext: (p) => getMessageContext(p.sessionId, p.messageIds, p.contextSize),
  getSearchMessageContext: (p) => getSearchMessageContext(p.sessionId, p.messageIds, p.contextBefore, p.contextAfter),
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

  // 深度搜索（LIKE 子串匹配）
  deepSearchMessages: (p) => deepSearchMessages(p.sessionId, p.keywords, p.filter, p.limit, p.offset, p.senderId),

  // 缓存管理
  invalidateAnalysisCache: (p) => {
    const queryCacheDir = getQueryCacheDir()
    if (queryCacheDir && p.sessionId) {
      deleteSessionCache(p.sessionId, queryCacheDir)
    }
    return true
  },
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

    // 可缓存查询：先查缓存，miss 后执行并写回
    const queryCacheDir = getQueryCacheDir()
    if (queryCacheDir && CACHEABLE_QUERIES.has(type) && payload.sessionId) {
      const cacheKey = buildAnalysisCacheKey(type, payload)
      const cached = getCache(payload.sessionId, cacheKey, queryCacheDir)
      if (cached !== null) {
        parentPort?.postMessage({ id, success: true, result: cached })
        return
      }
      const result = syncHandler(payload)
      setCache(payload.sessionId, cacheKey, result, queryCacheDir)
      parentPort?.postMessage({ id, success: true, result })
      return
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
