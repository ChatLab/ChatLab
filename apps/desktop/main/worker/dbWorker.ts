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
import { initDbDir, closeDatabase, closeAllDatabases, getCacheDir, getDbPath } from './core'
import { getDbFileVersion, getOrComputeAnalysisCache } from '@openchatlab/node-runtime'
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
  getLanguagePreferenceAnalysis,
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
  getAllIndexStats,
  updateSessionGapThreshold,
  getSessions,
  getSessionsByTimeRange,
  getRecentChatSessions,
  getSegmentSummariesInWorker,
  getSegmentMessages,
  // 导出
  exportFilterResultToFile,
  // NLP 查询
  getWordFrequency,
  segmentText,
  getPosTags,
} from './query'
import {
  streamImport,
  streamParseFileInfo,
  analyzeIncrementalImport,
  incrementalImport,
  analyzeNewImport,
} from './import'
import { initNlpDir } from '@openchatlab/node-runtime'

initDbDir(workerData.dbDir, workerData.cacheDir, workerData.tempDir)

// 初始化 NLP 词库目录
if (workerData.nlpDir) {
  initNlpDir(workerData.nlpDir)
}

// ==================== 分析结果缓存 ====================

const ANALYSIS_CACHE_PREFIX = 'analysis:'

// 缓存版本指纹的代码维度：随发布版本变化，使查询逻辑变更后的旧缓存失效。
const APP_VERSION: string = workerData?.appVersion ?? ''

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
  'getLanguagePreferenceAnalysis',
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
  getLanguagePreferenceAnalysis: (p) => getLanguagePreferenceAnalysis(p),
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

  // 通用 SQL 查询
  pluginQuery: (p) => executePluginQuery(p.sessionId, p.sql, p.params),

  // 会话索引
  generateSessions: (p) => generateSessions(p.sessionId, p.gapThreshold),
  generateIncrementalSessions: (p) => generateIncrementalSessions(p.sessionId, p.gapThreshold),
  clearSessions: (p) => clearSessions(p.sessionId),
  hasSessionIndex: (p) => hasSessionIndex(p.sessionId),
  getSessionStats: (p) => getSessionStats(p.sessionId),
  getAllIndexStats: (p) => getAllIndexStats(p.sessionIds),
  updateSessionGapThreshold: (p) => updateSessionGapThreshold(p.sessionId, p.gapThreshold),
  getSessions: (p) => getSessions(p.sessionId),
  getSessionsByTimeRange: (p) => getSessionsByTimeRange(p.sessionId, p.startTs, p.endTs),
  getRecentChatSessions: (p) => getRecentChatSessions(p.sessionId, p.limit),
  getSegmentSummaries: (p) => getSegmentSummariesInWorker(p.sessionId, p.options),
  getSegmentMessages: (p) => getSegmentMessages(p.sessionId, p.segmentId, p.limit),

  // NLP 查询
  getWordFrequency: (p) => getWordFrequency(p),
  segmentText: (p) => segmentText(p.text, p.locale, p.minLength),
  getPosTags: () => getPosTags(),

  // 深度搜索（LIKE 子串匹配）
  deepSearchMessages: (p) => deepSearchMessages(p.sessionId, p.keywords, p.filter, p.limit, p.offset, p.senderId),
}

// 异步消息处理器（流式操作）
const asyncHandlers: Record<string, (payload: any, requestId: string) => Promise<any>> = {
  // 流式导入
  streamImport: (p, id) => streamImport(p.filePath, id, p.formatOptions, p.externalSessionId),
  // 流式解析文件信息（用于合并预览）
  streamParseFileInfo: (p, id) => streamParseFileInfo(p.filePath, id),
  // 增量导入
  analyzeIncrementalImport: (p, id) => analyzeIncrementalImport(p.sessionId, p.filePath, id),
  incrementalImport: (p, id) => incrementalImport(p.sessionId, p.filePath, id, p.options),
  // Dry-run 分析（新会话）
  analyzeNewImport: (p, id) => analyzeNewImport(p.filePath, id),
  exportFilterResultToFile: async (p) => exportFilterResultToFile(p),
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

    // 可缓存查询：按「产品版本 + DB 文件状态」派生版本指纹，命中即返回，未命中则计算并写回。
    // 与共享 HTTP 路由共用同一份 cacheDir/query 文件与文件版本失效机制，数据变更后自动失效。
    const queryCacheDir = getQueryCacheDir()
    if (queryCacheDir && CACHEABLE_QUERIES.has(type) && payload.sessionId) {
      const cacheKey = buildAnalysisCacheKey(type, payload)
      const version = `${APP_VERSION}|${getDbFileVersion(getDbPath(payload.sessionId))}`
      const result = getOrComputeAnalysisCache(payload.sessionId, cacheKey, queryCacheDir, version, () =>
        syncHandler(payload)
      )
      parentPort?.postMessage({ id, success: true, result })
      return
    }

    const result = await syncHandler(payload)
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
