/**
 * Worker 管理器
 * 负责创建、管理 Worker 线程，并处理与主进程的通信
 */

import { Worker } from 'worker_threads'
import { app } from 'electron'
import * as path from 'path'
import type { ParseProgress } from '../parser'
import type { StreamImportResult } from './import'
import { openDatabase } from '../database/core'
import { getDatabaseDir, getCacheDir, ensureDir } from '../paths'

// Worker 实例
let worker: Worker | null = null

// 等待中的请求 Map
const pendingRequests = new Map<
  string,
  {
    resolve: (value: any) => void
    reject: (error: Error) => void
    onProgress?: (progress: ParseProgress) => void // 进度回调
  }
>()

// 请求 ID 计数器
let requestIdCounter = 0

/**
 * 获取数据库目录
 */
function getDbDir(): string {
  const dir = getDatabaseDir()
  ensureDir(dir)
  return dir
}

/**
 * 获取 Worker 文件路径
 * 开发环境和生产环境路径不同
 */
function getWorkerPath(): string {
  // 检查是否在开发环境
  const isDev = !app.isPackaged

  if (isDev) {
    // 开发环境：编译后的 JS 文件在 out/main 目录
    return path.join(__dirname, 'worker', 'dbWorker.js')
  } else {
    // 生产环境：打包后的路径
    return path.join(__dirname, 'worker', 'dbWorker.js')
  }
}

/**
 * 初始化 Worker
 */
export function initWorker(): void {
  if (worker) {
    console.log('[WorkerManager] Worker already initialized')
    return
  }

  const workerPath = getWorkerPath()
  console.log('[WorkerManager] Initializing worker at:', workerPath)

  try {
    worker = new Worker(workerPath, {
      workerData: {
        dbDir: getDbDir(),
        cacheDir: getCacheDir(),
      },
    })

    // 监听 Worker 消息
    worker.on('message', (message) => {
      const { id, type, success, result, error, payload } = message

      const pending = pendingRequests.get(id)
      if (!pending) return

      // 处理进度消息（不删除 pending，因为还没完成）
      if (type === 'progress') {
        if (pending.onProgress) {
          pending.onProgress(payload)
        }
        return
      }

      // 处理完成或错误消息
      pendingRequests.delete(id)

      if (success) {
        pending.resolve(result)
      } else {
        pending.reject(new Error(error))
      }
    })

    // 监听 Worker 错误
    worker.on('error', (error) => {
      console.error('[WorkerManager] Worker error:', error)
    })

    // 监听 Worker 退出
    worker.on('exit', (code) => {
      console.log('[WorkerManager] Worker exited with code:', code)
      worker = null

      // 拒绝所有等待中的请求
      for (const [id, pending] of pendingRequests.entries()) {
        pending.reject(new Error('Worker exited unexpectedly'))
        pendingRequests.delete(id)
      }
    })

    console.log('[WorkerManager] Worker initialized successfully')
  } catch (error) {
    console.error('[WorkerManager] Failed to initialize worker:', error)
    throw error
  }
}

/**
 * 发送消息到 Worker 并等待响应
 */
function sendToWorker<T>(type: string, payload: any, timeoutMs: number = 60000): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!worker) {
      try {
        initWorker()
      } catch (error) {
        reject(new Error('Worker not initialized'))
        return
      }
    }

    const id = `req_${++requestIdCounter}`

    pendingRequests.set(id, { resolve, reject })

    worker!.postMessage({ id, type, payload })

    // 设置超时
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id)
        reject(new Error(`Worker request timeout: ${type}`))
      }
    }, timeoutMs)
  })
}

/**
 * 发送消息到 Worker 并等待响应（带进度回调）
 * 用于流式导入等长时间操作
 */
function sendToWorkerWithProgress<T>(
  type: string,
  payload: any,
  onProgress?: (progress: ParseProgress) => void,
  timeoutMs: number = 600000 // 默认 10 分钟超时
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!worker) {
      try {
        initWorker()
      } catch (error) {
        reject(new Error('Worker not initialized'))
        return
      }
    }

    const id = `req_${++requestIdCounter}`

    pendingRequests.set(id, { resolve, reject, onProgress })

    worker!.postMessage({ id, type, payload })

    // 设置超时
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id)
        reject(new Error(`Worker request timeout: ${type}`))
      }
    }, timeoutMs)
  })
}

/**
 * 关闭 Worker（同步版本，用于一般场景）
 */
export function closeWorker(): void {
  if (worker) {
    // 先关闭所有数据库连接
    sendToWorker('closeAll', {}).catch(() => {})

    worker.terminate()
    worker = null
    console.log('[WorkerManager] Worker terminated')
  }
}

/**
 * 关闭 Worker（异步版本，确保数据库连接关闭后再终止）
 * 用于应用退出前的清理，确保 Worker 完全关闭
 */
export async function closeWorkerAsync(): Promise<void> {
  if (worker) {
    console.log('[WorkerManager] Closing worker async...')
    try {
      // 等待关闭所有数据库连接（最多等待 3 秒）
      await Promise.race([sendToWorker('closeAll', {}), new Promise((resolve) => setTimeout(resolve, 3000))])
    } catch {
      // 忽略错误，继续终止
    }

    worker.terminate()
    worker = null
    console.log('[WorkerManager] Worker terminated (async)')
  }
}

// ==================== 通用查询 API ====================

/**
 * 通用查询函数（用于新增的查询类型）
 */
export async function query<T = any>(type: string, payload: any): Promise<T> {
  return sendToWorker<T>(type, payload)
}

// ==================== 插件系统 API ====================

/**
 * 插件参数化只读 SQL 查询
 * 超时设为 120s，因为多个 pluginQuery 可能在 Worker 队列中排队等待
 */
export async function pluginQuery<T = Record<string, any>>(
  sessionId: string,
  sql: string,
  params: any[] | Record<string, any> = []
): Promise<T[]> {
  return sendToWorker('pluginQuery', { sessionId, sql, params }, 120000)
}

/**
 * 插件计算卸载（纯函数在 Worker 中执行）
 * 超时设为 120s，因为计算密集型任务 + 排队等待可能较长
 */
export async function pluginCompute<TOutput = any>(fnString: string, input: any): Promise<TOutput> {
  return sendToWorker('pluginCompute', { fnString, input }, 120000)
}

// ==================== 导出的异步 API ====================

export async function getAvailableYears(sessionId: string): Promise<number[]> {
  return sendToWorker('getAvailableYears', { sessionId })
}

export async function getMemberActivity(sessionId: string, filter?: any): Promise<any[]> {
  return sendToWorker('getMemberActivity', { sessionId, filter })
}

export async function getHourlyActivity(sessionId: string, filter?: any): Promise<any[]> {
  return sendToWorker('getHourlyActivity', { sessionId, filter })
}

export async function getDailyActivity(sessionId: string, filter?: any): Promise<any[]> {
  return sendToWorker('getDailyActivity', { sessionId, filter })
}

export async function getWeekdayActivity(sessionId: string, filter?: any): Promise<any[]> {
  return sendToWorker('getWeekdayActivity', { sessionId, filter })
}

export async function getMonthlyActivity(sessionId: string, filter?: any): Promise<any[]> {
  return sendToWorker('getMonthlyActivity', { sessionId, filter })
}

export async function getYearlyActivity(sessionId: string, filter?: any): Promise<any[]> {
  return sendToWorker('getYearlyActivity', { sessionId, filter })
}

export async function getMessageLengthDistribution(sessionId: string, filter?: any): Promise<any[]> {
  return sendToWorker('getMessageLengthDistribution', { sessionId, filter })
}

export async function getMessageTypeDistribution(sessionId: string, filter?: any): Promise<any[]> {
  return sendToWorker('getMessageTypeDistribution', { sessionId, filter })
}

export async function getTimeRange(sessionId: string): Promise<{ start: number; end: number } | null> {
  return sendToWorker('getTimeRange', { sessionId })
}

export async function getMemberNameHistory(sessionId: string, memberId: number): Promise<any[]> {
  return sendToWorker('getMemberNameHistory', { sessionId, memberId })
}

export async function getCatchphraseAnalysis(sessionId: string, filter?: any): Promise<any> {
  return sendToWorker('getCatchphraseAnalysis', { sessionId, filter })
}

export async function getMentionAnalysis(sessionId: string, filter?: any): Promise<any> {
  return sendToWorker('getMentionAnalysis', { sessionId, filter })
}

export async function getMentionGraph(sessionId: string, filter?: any): Promise<any> {
  return sendToWorker('getMentionGraph', { sessionId, filter })
}

export async function getLaughAnalysis(sessionId: string, filter?: any, keywords?: string[]): Promise<any> {
  return sendToWorker('getLaughAnalysis', { sessionId, filter, keywords })
}

export async function getClusterGraph(sessionId: string, filter?: any, options?: any): Promise<any> {
  return sendToWorker('getClusterGraph', { sessionId, filter, options })
}

export async function getAllSessions(): Promise<any[]> {
  return sendToWorker('getAllSessions', {})
}

export async function getSession(sessionId: string): Promise<any | null> {
  return sendToWorker('getSession', { sessionId })
}

export async function getChatOverview(
  sessionId: string,
  topN?: number
): Promise<{
  name: string
  platform: string
  type: string
  totalMessages: number
  totalMembers: number
  firstMessageTs: number | null
  lastMessageTs: number | null
  topMembers: Array<{ id: number; name: string; count: number }>
} | null> {
  return sendToWorker('getChatOverview', { sessionId, topN })
}

export async function closeDatabase(sessionId: string): Promise<void> {
  return sendToWorker('closeDatabase', { sessionId })
}

// ==================== 成员管理 API ====================

export interface MemberWithStats {
  id: number
  platformId: string
  accountName: string | null
  groupNickname: string | null
  aliases: string[]
  messageCount: number
  avatar?: string | null
}

/**
 * 获取所有成员列表（含消息数和别名）
 */
export async function getMembers(sessionId: string): Promise<MemberWithStats[]> {
  return sendToWorker('getMembers', { sessionId })
}

/**
 * 获取成员列表（分页版本）
 */
export async function getMembersPaginated(
  sessionId: string,
  params: {
    page: number
    pageSize: number
    search?: string
    sortOrder?: 'asc' | 'desc'
  }
): Promise<{
  members: MemberWithStats[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}> {
  return sendToWorker('getMembersPaginated', { sessionId, params })
}

/**
 * 更新成员别名
 */
export async function updateMemberAliases(sessionId: string, memberId: number, aliases: string[]): Promise<boolean> {
  return sendToWorker('updateMemberAliases', { sessionId, memberId, aliases })
}

/**
 * 删除成员及其所有消息
 */
export async function deleteMember(sessionId: string, memberId: number): Promise<boolean> {
  return sendToWorker('deleteMember', { sessionId, memberId })
}

/**
 * 流式解析文件，写入临时数据库（用于合并功能）
 * 返回基本信息和临时数据库路径
 */
export async function streamParseFileInfo(
  filePath: string,
  onProgress?: (progress: ParseProgress) => void
): Promise<{
  name: string
  format: string
  platform: string
  messageCount: number
  memberCount: number
  fileSize: number
  tempDbPath: string
}> {
  return sendToWorkerWithProgress('streamParseFileInfo', { filePath }, onProgress)
}

/**
 * 流式导入聊天记录
 * @param filePath 文件路径
 * @param onProgress 进度回调
 * @param formatOptions 格式特定选项（如 Telegram 的 chatIndex）
 */
export async function streamImport(
  filePath: string,
  onProgress?: (progress: ParseProgress) => void,
  formatOptions?: Record<string, unknown>
): Promise<StreamImportResult> {
  return sendToWorkerWithProgress('streamImport', { filePath, formatOptions }, onProgress)
}

/**
 * 获取数据库目录（供外部使用）
 */
export function getDbDirectory(): string {
  return getDbDir()
}

// ==================== AI 查询 API ====================

export interface SearchMessageResult {
  id: number
  senderName: string
  senderPlatformId: string
  senderAliases: string[]
  senderAvatar: string | null
  content: string
  timestamp: number
  type: number
}

/**
 * 关键词搜索消息
 */
export async function searchMessages(
  sessionId: string,
  keywords: string[],
  filter?: any,
  limit?: number,
  offset?: number,
  senderId?: number
): Promise<{ messages: SearchMessageResult[]; total: number }> {
  return sendToWorker('searchMessages', { sessionId, keywords, filter, limit, offset, senderId })
}

/**
 * 深度搜索消息（LIKE 子串匹配，速度较慢但不会遗漏）
 */
export async function deepSearchMessages(
  sessionId: string,
  keywords: string[],
  filter?: any,
  limit?: number,
  offset?: number,
  senderId?: number
): Promise<{ messages: SearchMessageResult[]; total: number }> {
  return sendToWorker('deepSearchMessages', { sessionId, keywords, filter, limit, offset, senderId })
}

/**
 * 获取消息上下文
 * 支持单个或批量消息 ID，返回合并去重后的上下文消息
 */
export async function getMessageContext(
  sessionId: string,
  messageIds: number | number[],
  contextSize?: number
): Promise<SearchMessageResult[]> {
  return sendToWorker('getMessageContext', { sessionId, messageIds, contextSize })
}

/**
 * 获取最近消息（用于概览性问题）
 */
export async function getRecentMessages(
  sessionId: string,
  filter?: any,
  limit?: number
): Promise<{ messages: SearchMessageResult[]; total: number }> {
  return sendToWorker('getRecentMessages', { sessionId, filter, limit })
}

/**
 * 获取所有最近消息（消息查看器专用，包含所有类型消息）
 */
export async function getAllRecentMessages(
  sessionId: string,
  filter?: any,
  limit?: number
): Promise<{ messages: SearchMessageResult[]; total: number }> {
  return sendToWorker('getAllRecentMessages', { sessionId, filter, limit })
}

/**
 * 获取两个成员之间的对话
 */
export async function getConversationBetween(
  sessionId: string,
  memberId1: number,
  memberId2: number,
  filter?: any,
  limit?: number
): Promise<{ messages: SearchMessageResult[]; total: number; member1Name: string; member2Name: string }> {
  return sendToWorker('getConversationBetween', { sessionId, memberId1, memberId2, filter, limit })
}

/**
 * 获取指定消息之前的 N 条消息（用于向上无限滚动）
 */
export async function getMessagesBefore(
  sessionId: string,
  beforeId: number,
  limit?: number,
  filter?: any,
  senderId?: number,
  keywords?: string[]
): Promise<{ messages: SearchMessageResult[]; hasMore: boolean }> {
  return sendToWorker('getMessagesBefore', { sessionId, beforeId, limit, filter, senderId, keywords })
}

/**
 * 获取指定消息之后的 N 条消息（用于向下无限滚动）
 */
export async function getMessagesAfter(
  sessionId: string,
  afterId: number,
  limit?: number,
  filter?: any,
  senderId?: number,
  keywords?: string[]
): Promise<{ messages: SearchMessageResult[]; hasMore: boolean }> {
  return sendToWorker('getMessagesAfter', { sessionId, afterId, limit, filter, senderId, keywords })
}

// ==================== SQL 实验室 API ====================

export interface SQLResult {
  columns: string[]
  rows: any[][]
  rowCount: number
  duration: number
  limited: boolean
}

export interface TableSchema {
  name: string
  columns: {
    name: string
    type: string
    notnull: boolean
    pk: boolean
  }[]
}

/**
 * 执行用户 SQL 查询
 */
export async function executeRawSQL(sessionId: string, sql: string): Promise<SQLResult> {
  return sendToWorker('executeRawSQL', { sessionId, sql })
}

/**
 * 获取数据库 Schema
 */
export async function getSchema(sessionId: string): Promise<TableSchema[]> {
  return sendToWorker('getSchema', { sessionId })
}

// ==================== 会话索引 API ====================

export interface SessionStats {
  sessionCount: number
  hasIndex: boolean
  gapThreshold: number
}

/**
 * 生成会话索引
 * @param sessionId 数据库会话ID
 * @param gapThreshold 时间间隔阈值（秒）
 */
export async function generateSessions(sessionId: string, gapThreshold?: number): Promise<number> {
  return sendToWorker('generateSessions', { sessionId, gapThreshold })
}

/**
 * 增量生成会话索引（仅处理未索引的新消息，保留已有会话和摘要）
 */
export async function generateIncrementalSessions(sessionId: string, gapThreshold?: number): Promise<number> {
  return sendToWorker('generateIncrementalSessions', { sessionId, gapThreshold })
}

/**
 * 清空会话索引
 */
export async function clearSessions(sessionId: string): Promise<void> {
  return sendToWorker('clearSessions', { sessionId })
}

/**
 * 检查是否已生成会话索引
 */
export async function hasSessionIndex(sessionId: string): Promise<boolean> {
  return sendToWorker('hasSessionIndex', { sessionId })
}

/**
 * 获取会话索引统计信息
 */
export async function getSessionStats(sessionId: string): Promise<SessionStats> {
  return sendToWorker('getSessionStats', { sessionId })
}

/**
 * 更新单个聊天的会话切分阈值
 */
export async function updateSessionGapThreshold(sessionId: string, gapThreshold: number | null): Promise<void> {
  return sendToWorker('updateSessionGapThreshold', { sessionId, gapThreshold })
}

/**
 * 会话列表项类型
 */
export interface ChatSessionItem {
  id: number
  startTs: number
  endTs: number
  messageCount: number
  firstMessageId: number
}

/**
 * 获取会话列表（用于时间线导航）
 */
export async function getSessions(sessionId: string): Promise<ChatSessionItem[]> {
  return sendToWorker('getSessions', { sessionId })
}

// ==================== AI 工具专用查询函数 ====================

/**
 * 会话搜索结果项类型（用于 AI 工具）
 */
export interface SessionSearchResultItem {
  id: number
  startTs: number
  endTs: number
  messageCount: number
  isComplete: boolean
  previewMessages: Array<{
    id: number
    senderName: string
    content: string | null
    timestamp: number
  }>
}

/**
 * 搜索会话（用于 AI 工具）
 */
export async function searchSessions(
  sessionId: string,
  keywords?: string[],
  timeFilter?: { startTs: number; endTs: number },
  limit?: number,
  previewCount?: number
): Promise<SessionSearchResultItem[]> {
  return sendToWorker('searchSessions', { sessionId, keywords, timeFilter, limit, previewCount })
}

/**
 * 会话消息结果类型（用于 AI 工具）
 */
export interface SessionMessagesResult {
  sessionId: number
  startTs: number
  endTs: number
  messageCount: number
  returnedCount: number
  participants: string[]
  messages: Array<{
    id: number
    senderName: string
    content: string | null
    timestamp: number
  }>
}

/**
 * 获取会话的完整消息（用于 AI 工具）
 */
export async function getSessionMessages(
  sessionId: string,
  chatSessionId: number,
  limit?: number
): Promise<SessionMessagesResult | null> {
  return sendToWorker('getSessionMessages', { sessionId, chatSessionId, limit })
}

/**
 * 会话摘要结果类型（用于 AI 工具）
 */
export interface SessionSummaryItem {
  id: number
  startTs: number
  endTs: number
  messageCount: number
  participants: string[]
  summary: string | null
}

/**
 * 获取带摘要的会话列表（用于 AI 工具）
 * 直接在主进程中查询，不通过 Worker
 */
export async function getSessionSummaries(
  sessionId: string,
  options: {
    limit?: number
    timeFilter?: { startTs: number; endTs: number }
  }
): Promise<SessionSummaryItem[]> {
  const db = openDatabase(sessionId, true)
  if (!db) {
    return []
  }

  const { limit = 50, timeFilter } = options

  let sql = `
    SELECT
      cs.id,
      cs.start_ts as startTs,
      cs.end_ts as endTs,
      cs.message_count as messageCount,
      cs.summary
    FROM chat_session cs
    WHERE cs.summary IS NOT NULL AND cs.summary != ''
  `
  const params: unknown[] = []

  if (timeFilter) {
    sql += ' AND cs.start_ts >= ? AND cs.start_ts <= ?'
    params.push(timeFilter.startTs, timeFilter.endTs)
  }

  sql += ' ORDER BY cs.start_ts DESC LIMIT ?'
  params.push(limit)

  try {
    const sessions = db.prepare(sql).all(...params) as Array<{
      id: number
      startTs: number
      endTs: number
      messageCount: number
      summary: string | null
    }>

    // 为每个会话获取参与者
    const results: SessionSummaryItem[] = []
    for (const session of sessions) {
      const participantsSql = `
        SELECT DISTINCT COALESCE(mb.group_nickname, mb.account_name, mb.platform_id) as name
        FROM message_context mc
        JOIN message m ON m.id = mc.message_id
        JOIN member mb ON mb.id = m.sender_id
        WHERE mc.session_id = ?
        LIMIT 10
      `
      const participants = db.prepare(participantsSql).all(session.id) as Array<{ name: string }>

      results.push({
        id: session.id,
        startTs: session.startTs,
        endTs: session.endTs,
        messageCount: session.messageCount,
        participants: participants.map((p) => p.name),
        summary: session.summary,
      })
    }

    return results
  } catch (error) {
    console.error('Failed to get session summaries:', error)
    return []
  }
}

// ==================== 自定义筛选 API ====================

/**
 * 筛选消息类型（完整信息）
 */
export interface FilterMessage {
  id: number
  senderName: string
  senderPlatformId: string
  senderAliases: string[]
  senderAvatar: string | null
  content: string
  timestamp: number
  type: number
  replyToMessageId: string | null
  replyToContent: string | null
  replyToSenderName: string | null
  isHit: boolean
}

/**
 * 上下文块类型
 */
export interface ContextBlock {
  startTs: number
  endTs: number
  messages: FilterMessage[]
  hitCount: number
}

/**
 * 筛选结果类型
 */
export interface FilterResult {
  blocks: ContextBlock[]
  stats: {
    totalMessages: number
    hitMessages: number
    totalChars: number
  }
}

/**
 * 分页信息类型
 */
export interface PaginationInfo {
  page: number
  pageSize: number
  totalBlocks: number
  totalHits: number
  hasMore: boolean
}

/**
 * 带分页的筛选结果类型
 */
export interface FilterResultWithPagination extends FilterResult {
  pagination: PaginationInfo
}

/**
 * 按条件筛选消息并扩充上下文（支持分页）
 */
export async function filterMessagesWithContext(
  sessionId: string,
  keywords?: string[],
  timeFilter?: { startTs: number; endTs: number },
  senderIds?: number[],
  contextSize?: number,
  page?: number,
  pageSize?: number
): Promise<FilterResultWithPagination> {
  return sendToWorker('filterMessagesWithContext', {
    sessionId,
    keywords,
    timeFilter,
    senderIds,
    contextSize,
    page,
    pageSize,
  })
}

/**
 * 获取多个会话的完整消息（支持分页）
 */
export async function getMultipleSessionsMessages(
  sessionId: string,
  chatSessionIds: number[],
  page?: number,
  pageSize?: number
): Promise<FilterResultWithPagination> {
  return sendToWorker('getMultipleSessionsMessages', { sessionId, chatSessionIds, page, pageSize })
}

/**
 * 导出筛选结果参数
 */
export interface ExportFilterParams {
  sessionId: string
  sessionName: string
  outputDir: string
  filterMode: 'condition' | 'session'
  keywords?: string[]
  timeFilter?: { startTs: number; endTs: number }
  senderIds?: number[]
  contextSize?: number
  chatSessionIds?: number[]
}

/**
 * 导出进度回调类型
 */
export interface ExportProgress {
  stage: 'preparing' | 'exporting' | 'done' | 'error'
  currentBlock: number
  totalBlocks: number
  percentage: number
  message: string
}

/**
 * 导出筛选结果到文件（后端生成）
 * 使用 10 分钟超时，支持大数据量导出和进度回调
 */
export async function exportFilterResultToFile(
  params: ExportFilterParams,
  onProgress?: (progress: ExportProgress) => void
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  return sendToWorkerWithProgress('exportFilterResultToFile', params, onProgress as any, 600000)
}

// ==================== 增量导入 ====================

/**
 * 增量导入分析结果
 */
export interface IncrementalAnalyzeResult {
  newMessageCount: number
  duplicateCount: number
  totalInFile: number
  error?: string
}

/**
 * 分析增量导入（检测去重后能新增多少消息）
 */
export async function analyzeIncrementalImport(sessionId: string, filePath: string): Promise<IncrementalAnalyzeResult> {
  return sendToWorker('analyzeIncrementalImport', { sessionId, filePath })
}

/**
 * 增量导入结果
 */
export interface IncrementalImportResult {
  success: boolean
  newMessageCount: number
  error?: string
}

/**
 * 执行增量导入
 */
export async function incrementalImport(
  sessionId: string,
  filePath: string,
  onProgress?: (progress: ParseProgress) => void
): Promise<IncrementalImportResult> {
  return sendToWorkerWithProgress('incrementalImport', { sessionId, filePath }, onProgress)
}
