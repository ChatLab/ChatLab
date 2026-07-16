/**
 * Worker 管理器
 * 负责创建、管理 Worker 线程，并处理与主进程的通信
 */

import { Worker } from 'worker_threads'
import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import type { ParseProgress } from '../parser'
import type { AutoImportResult, StreamImportResult } from './import'

import { getDatabaseDir, getCacheDir, getTempDir, getLogsDir, ensureDir } from '../paths'
import { getNlpDir } from '../nlp/dictManager'
import { resolveDesktopNativeBinding } from '../native-sqlite'
import { assertDesktopDataDirCompatible, getDesktopAppVersion } from '../runtime-compat'
import { getPathProvider } from '../path-context'
import {
  IMPORT_IN_PROGRESS_ERROR_KEY,
  ImportInProgressError,
  raiseChatDbCompatibilityGate,
  withDataDirImportLock,
} from '@openchatlab/node-runtime'
import type { PushImportAnalysisOutcome, PushImportOutcome, PushImportPayload } from '@openchatlab/node-runtime'
import { getWorkerRequestTimeoutMs, isRestartableReadOnlyRequestType } from './workerTimeoutPolicy'

interface WorkerRequestOptions {
  timeoutMs?: number
  restartOnTimeout?: boolean
}

// Worker 实例
let worker: Worker | null = null

// 等待中的请求 Map
const pendingRequests = new Map<
  string,
  {
    resolve: (value: any) => void
    reject: (error: Error) => void
    timeout: ReturnType<typeof setTimeout>
    restartOnTimeout: boolean
    onProgress?: (progress: ParseProgress) => void // 进度回调
  }
>()

// 请求 ID 计数器
let requestIdCounter = 0

function hasProgressRequest(): boolean {
  for (const pending of pendingRequests.values()) {
    if (pending.onProgress) return true
  }
  return false
}

function rejectAllPending(error: Error): void {
  for (const [id, pending] of pendingRequests.entries()) {
    clearTimeout(pending.timeout)
    pending.reject(error)
    pendingRequests.delete(id)
  }
}

function hasNonRestartableRequest(): boolean {
  for (const pending of pendingRequests.values()) {
    if (!pending.restartOnTimeout) return true
  }
  return false
}

function terminateWorkerAfterQueryTimeout(type: string, timedOutWorker: Worker): void {
  if (!worker || worker !== timedOutWorker) return

  if (hasProgressRequest()) {
    console.warn(`[WorkerManager] Query timed out while a progress task is active; keeping worker alive: ${type}`)
    return
  }

  if (hasNonRestartableRequest()) {
    console.warn(`[WorkerManager] Query timed out while non-restartable work is active; keeping worker alive: ${type}`)
    return
  }

  console.warn(`[WorkerManager] Restarting worker after request timeout: ${type}`)
  worker = null
  rejectAllPending(new Error(`Worker restarted after request timeout: ${type}`))
  timedOutWorker.terminate().catch((error) => {
    console.error('[WorkerManager] Failed to terminate timed-out worker:', error)
  })
}

/**
 * 获取数据库目录
 */
function getDbDir(): string {
  const dir = getDatabaseDir()
  ensureDir(dir)
  return dir
}

function assertDataDirCompatibleNow(): void {
  assertDesktopDataDirCompatible(getPathProvider(), getDesktopAppVersion(app.getVersion()))
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
    const initializedWorker = new Worker(workerPath, {
      workerData: {
        dbDir: getDbDir(),
        cacheDir: getCacheDir(),
        tempDir: getTempDir(),
        logsDir: getLogsDir(),
        nlpDir: getNlpDir(),
        appVersion: getDesktopAppVersion(app.getVersion()),
        // Worker threads cannot resolve the Electron-ABI binding themselves; hand it over.
        nativeBinding: resolveDesktopNativeBinding(),
      },
    })
    worker = initializedWorker

    // 监听 Worker 消息
    initializedWorker.on('message', (message) => {
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
      clearTimeout(pending.timeout)

      if (success) {
        pending.resolve(result)
      } else {
        pending.reject(new Error(error))
      }
    })

    // 监听 Worker 错误
    initializedWorker.on('error', (error) => {
      console.error('[WorkerManager] Worker error:', error)
    })

    // 监听 Worker 退出
    initializedWorker.on('exit', (code) => {
      console.log('[WorkerManager] Worker exited with code:', code)
      if (worker !== initializedWorker) {
        console.log('[WorkerManager] Ignoring exit from replaced worker')
        return
      }
      worker = null

      // 拒绝所有等待中的请求
      rejectAllPending(new Error('Worker exited unexpectedly'))
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
function sendToWorker<T>(type: string, payload: any, options: number | WorkerRequestOptions = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!worker) {
      try {
        initWorker()
      } catch (error) {
        reject(new Error('Worker not initialized'))
        return
      }
    }

    const timeoutMs = typeof options === 'number' ? options : (options.timeoutMs ?? getWorkerRequestTimeoutMs(type))
    const restartOnTimeout =
      typeof options === 'number'
        ? isRestartableReadOnlyRequestType(type)
        : (options.restartOnTimeout ?? isRestartableReadOnlyRequestType(type))
    const requestWorker = worker!
    const id = `req_${++requestIdCounter}`

    const timeout = setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id)
        reject(new Error(`Worker request timeout: ${type}`))
        if (restartOnTimeout) {
          terminateWorkerAfterQueryTimeout(type, requestWorker)
        }
      }
    }, timeoutMs)

    pendingRequests.set(id, { resolve, reject, timeout, restartOnTimeout })

    requestWorker.postMessage({ id, type, payload })
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

    const requestWorker = worker!
    const id = `req_${++requestIdCounter}`

    const timeout = setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id)
        reject(new Error(`Worker request timeout: ${type}`))
      }
    }, timeoutMs)

    pendingRequests.set(id, { resolve, reject, timeout, restartOnTimeout: false, onProgress })

    requestWorker.postMessage({ id, type, payload })
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
    rejectAllPending(new Error('Worker terminated'))
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
    rejectAllPending(new Error('Worker terminated'))
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

export async function getLanguagePreferenceAnalysis(params: {
  sessionId: string
  locale: string
  timeFilter?: any
  dictType?: string
}): Promise<any> {
  return sendToWorker('getLanguagePreferenceAnalysis', params)
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

export async function getRelationshipStats(sessionId: string, filter?: any, options?: any): Promise<any> {
  return sendToWorker('getRelationshipStats', { sessionId, filter, options })
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
  summaryCount: number
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
  lastMessageTs: number | null
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
 * 合并两个成员（保留消息数更多的一方）
 */
export async function mergeMembers(sessionId: string, memberId1: number, memberId2: number): Promise<boolean> {
  return sendToWorker('mergeMembers', { sessionId, memberId1, memberId2 })
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
async function streamImportUnlocked(
  filePath: string,
  onProgress?: (progress: ParseProgress) => void,
  formatOptions?: Record<string, unknown>,
  externalSessionId?: string
): Promise<StreamImportResult> {
  assertDataDirCompatibleNow()

  const result = await sendToWorkerWithProgress<StreamImportResult>(
    'streamImport',
    { filePath, formatOptions, externalSessionId },
    onProgress
  )
  if (!result.success || !result.sessionId) return result

  try {
    raiseChatDbCompatibilityGate(getPathProvider(), {
      version: getDesktopAppVersion(app.getVersion()),
      kind: 'desktop',
    })
  } catch (error) {
    deleteImportedSessionFiles(result.sessionId)
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      diagnostics: result.diagnostics,
    }
  }

  return result
}

export async function streamImport(
  filePath: string,
  onProgress?: (progress: ParseProgress) => void,
  formatOptions?: Record<string, unknown>,
  externalSessionId?: string
): Promise<StreamImportResult> {
  try {
    return await withDataDirImportLock(getPathProvider().getUserDataDir(), () =>
      streamImportUnlocked(filePath, onProgress, formatOptions, externalSessionId)
    )
  } catch (error) {
    if (error instanceof ImportInProgressError) {
      return { success: false, error: IMPORT_IN_PROGRESS_ERROR_KEY }
    }
    throw error
  }
}

export async function autoImport(
  filePath: string,
  onProgress?: (progress: ParseProgress) => void,
  formatOptions?: Record<string, unknown>,
  explicitSessionId?: string
): Promise<AutoImportResult> {
  try {
    return await withDataDirImportLock(getPathProvider().getUserDataDir(), async () => {
      assertDataDirCompatibleNow()

      const result = await sendToWorkerWithProgress<AutoImportResult>(
        'autoImport',
        { filePath, formatOptions, explicitSessionId },
        onProgress
      )
      if (!result.success || !result.sessionId || result.importMode !== 'created') return result

      try {
        raiseChatDbCompatibilityGate(getPathProvider(), {
          version: getDesktopAppVersion(app.getVersion()),
          kind: 'desktop',
        })
      } catch (error) {
        deleteImportedSessionFiles(result.sessionId)
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          diagnostics: result.diagnostics,
        }
      }

      return result
    })
  } catch (error) {
    if (error instanceof ImportInProgressError) {
      return { success: false, error: IMPORT_IN_PROGRESS_ERROR_KEY }
    }
    throw error
  }
}

/**
 * 在 worker 中执行共享 Push Import 写库语义；主进程持有全局导入锁，
 * 并在 worker 成功后完成数据目录兼容门禁更新。
 */
export async function pushImport(sessionId: string, payload: PushImportPayload): Promise<PushImportOutcome> {
  try {
    return await withDataDirImportLock(getPathProvider().getUserDataDir(), async () => {
      assertDataDirCompatibleNow()
      const outcome = await sendToWorker<PushImportOutcome>('pushImport', { sessionId, payload })
      if (!outcome.ok) return outcome

      try {
        raiseChatDbCompatibilityGate(getPathProvider(), {
          version: getDesktopAppVersion(app.getVersion()),
          kind: 'desktop',
        })
      } catch (error) {
        if (outcome.result.created) deleteImportedSessionFiles(sessionId)
        throw error
      }
      return outcome
    })
  } catch (error) {
    if (error instanceof ImportInProgressError) {
      return {
        ok: false,
        reason: 'import_in_progress',
        message: 'Another import is already in progress',
      }
    }
    throw error
  }
}

/**
 * 在 worker 中只读分析 JSON Push 请求，确保 Desktop dry-run 与正式写入使用同一套语义。
 */
export async function analyzePushImport(
  sessionId: string,
  payload: PushImportPayload
): Promise<PushImportAnalysisOutcome> {
  assertDataDirCompatibleNow()
  return sendToWorker<PushImportAnalysisOutcome>('analyzePushImport', { sessionId, payload })
}

function deleteImportedSessionFiles(sessionId: string): void {
  const dbPath = path.join(getDbDir(), `${sessionId}.db`)
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      const p = dbPath + suffix
      if (fs.existsSync(p)) fs.unlinkSync(p)
    } catch {
      /* ignore */
    }
  }
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
  senderId: number
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
 * 获取搜索结果的上下文消息（会话感知 + 区间合并去重）
 */
export async function getSearchMessageContext(
  sessionId: string,
  messageIds: number[],
  contextBefore?: number,
  contextAfter?: number
): Promise<SearchMessageResult[]> {
  return sendToWorker('getSearchMessageContext', { sessionId, messageIds, contextBefore, contextAfter })
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
export async function executeRawSQL(sessionId: string, sql: string, maxRows?: number): Promise<SQLResult> {
  return sendToWorker('executeRawSQL', { sessionId, sql, maxRows })
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

export async function getAllIndexStats(): Promise<
  Array<{ sessionId: string; hasIndex: boolean; sessionCount: number }>
> {
  const sessions = await getAllSessions()
  const sessionIds = sessions.map((s: any) => s.id)
  return sendToWorker('getAllIndexStats', { sessionIds })
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

/**
 * 根据时间范围查询会话列表
 */
export async function getSessionsByTimeRange(
  sessionId: string,
  startTs: number,
  endTs: number
): Promise<ChatSessionItem[]> {
  return sendToWorker('getSessionsByTimeRange', { sessionId, startTs, endTs })
}

/**
 * 获取最近 N 条会话
 */
export async function getRecentChatSessions(sessionId: string, limit: number): Promise<ChatSessionItem[]> {
  return sendToWorker('getRecentChatSessions', { sessionId, limit })
}

// ==================== AI 工具专用查询函数 ====================

export type { SessionMessagesResult } from './query/session'

export async function getSegmentMessages(
  sessionId: string,
  segmentId: number,
  limit?: number
): Promise<import('./query/session').SessionMessagesResult | null> {
  return sendToWorker('getSegmentMessages', { sessionId, segmentId, limit })
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
 */
export async function getSegmentSummaries(
  sessionId: string,
  options: {
    limit?: number
    timeFilter?: { startTs: number; endTs: number }
  }
): Promise<SessionSummaryItem[]> {
  return sendToWorker('getSegmentSummaries', { sessionId, options })
}

// ==================== 导出 API ====================

export interface ExportFileParams {
  sessionId: string
  sessionName: string
  outputDir: string
  format?: 'txt' | 'json' | 'markdown'
  timeFilter?: { startTs: number; endTs: number }
}

export async function exportFilterResultToFile(
  params: ExportFileParams
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  return sendToWorker('exportFilterResultToFile', params, 600000)
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
 * 导入选项（控制 meta/members 更新行为）
 */
export interface ImportOptions {
  metaUpdateMode?: 'patch' | 'none'
  memberUpdateMode?: 'upsert' | 'none'
}

/**
 * 增量导入结果
 */
export interface IncrementalImportResult {
  success: boolean
  newMessageCount: number
  error?: string
  batch?: {
    receivedCount: number
    writtenCount: number
    duplicateCount: number
    errorCount: number
    errorReasonCounts: Record<string, number>
    errorSample: Array<{ index: number; reason: string; detail: string }>
  }
  session?: {
    totalCount: number
    memberCount: number
    firstTimestamp: number
    lastTimestamp: number
  }
  updates?: {
    metaUpdated: boolean
    membersAdded: number
    membersUpdated: number
  }
}

/**
 * 执行增量导入
 */
export async function incrementalImport(
  sessionId: string,
  filePath: string,
  onProgress?: (progress: ParseProgress) => void,
  options?: ImportOptions
): Promise<IncrementalImportResult> {
  try {
    return await withDataDirImportLock(getPathProvider().getUserDataDir(), async () => {
      assertDataDirCompatibleNow()
      return sendToWorkerWithProgress('incrementalImport', { sessionId, filePath, options }, onProgress)
    })
  } catch (error) {
    if (error instanceof ImportInProgressError) {
      return { success: false, newMessageCount: 0, error: IMPORT_IN_PROGRESS_ERROR_KEY }
    }
    throw error
  }
}

/**
 * Dry-run analysis result for new sessions
 */
export interface AnalyzeNewImportResult {
  totalMessages: number
  newMessageCount: number
  duplicateCount: number
  totalMembers: number
  meta: { name: string; platform: string; type: string } | null
  error?: string
}

/**
 * Analyze a new import file without writing to DB (dry-run)
 */
export async function analyzeNewImport(filePath: string): Promise<AnalyzeNewImportResult> {
  return sendToWorker('analyzeNewImport', { filePath })
}
