/**
 * ImportAdapter — 导入领域的适配器接口
 *
 * 涵盖：文件导入、格式检测、Demo 导入、增量导入
 * Electron 通过 window.chatApi IPC 实现，Web 通过 HTTP + SSE 实现。
 */

import type { ImportProgress } from '@/types/base'

// ==================== 导入选项 ====================

export interface ImportOptions {
  formatId?: string
  chatIndex?: number
}

// ==================== 导入结果 ====================

export type AutoImportMode = 'created' | 'incremental'
export type AutoImportMatchMethod = 'source-session-id' | 'stable-id' | 'trailing-messages'
export type AutoImportCreateReason = 'no-match' | 'ambiguous'

export interface ImportResult {
  success: boolean
  sessionId?: string
  error?: string
  importMode?: AutoImportMode
  matchedBy?: AutoImportMatchMethod
  createReason?: AutoImportCreateReason
  newMessageCount?: number
  duplicateCount?: number
  messageCount?: number
  memberCount?: number
  diagnostics?: ImportDiagnosticsInfo
}

export function normalizeImportResult(result: ImportResult): ImportResult {
  return {
    success: result.success,
    sessionId: result.sessionId,
    error: result.error,
    importMode: result.importMode,
    matchedBy: result.matchedBy,
    createReason: result.createReason,
    newMessageCount: result.newMessageCount,
    duplicateCount: result.duplicateCount,
    messageCount: result.messageCount,
    memberCount: result.memberCount,
    diagnostics: result.diagnostics,
  }
}

export interface ImportDiagnosticsInfo {
  logFile: string | null
  detectedFormat: string | null
  messagesReceived: number
  messagesWritten: number
  duplicateCount: number
  messagesSkipped: number
  skipReasons: {
    noSenderId: number
    noAccountName: number
    invalidTimestamp: number
    noType: number
  }
}

// ==================== 格式信息 ====================

export interface FormatInfo {
  id: string
  name: string
  platform: string
  extensions: string[]
  multiChat?: boolean
}

export interface MultiChatEntry {
  index: number
  name: string
  type: string
  id: number
  messageCount: number
}

export interface PreparedImportChat {
  chatId: string
  name: string
  type: 'private' | 'group'
  messageCount: number
  memberCount: number
}

export interface PreparedImportSource {
  sourceId: string
  formatId: string
  platform: string
  chats: PreparedImportChat[]
  expiresAt: number
}

export interface PreparedImportSourceResult {
  success: boolean
  source?: PreparedImportSource
  error?: string
}

// ==================== Demo 导入 ====================

export interface DemoProgress {
  stage: 'downloading' | 'importing'
}

export interface DemoImportResult {
  success: boolean
  groupSessionId?: string
  privateSessionIds?: string[]
  error?: string
}

// ==================== 增量导入 ====================

export interface IncrementalAnalysis {
  newMessageCount: number
  duplicateCount: number
  totalInFile: number
  error?: string
}

export interface IncrementalImportResult {
  success: boolean
  newMessageCount: number
  error?: string
}

// ==================== 核心接口 ====================

export interface ImportAdapter {
  /**
   * 导入文件。Electron 接受 File 或文件路径，Web 只接受 File。
   */
  importFile(
    file: File | string,
    options?: ImportOptions,
    onProgress?: (p: ImportProgress) => void
  ): Promise<ImportResult>

  /** Cancel the active import when the runtime supports cooperative cancellation. */
  cancelActiveImport?(): void

  /** 检测文件格式 */
  detectFormat(file: File | string): Promise<FormatInfo | null>

  /** 扫描包含多个聊天的文件 */
  scanMultiChatFile(file: File | string): Promise<MultiChatEntry[]>

  /** 注册 ZIP 导入源。Web 上传一次，Electron 记录本地路径。 */
  prepareImportSource(file: File | string): Promise<PreparedImportSourceResult>

  /** 从已注册导入源中导入一个聊天。 */
  importPreparedChat(sourceId: string, chatId: string, onProgress?: (p: ImportProgress) => void): Promise<ImportResult>

  /** 释放导入源及其临时文件；重复调用应保持幂等。 */
  releaseImportSource(sourceId: string): Promise<void>

  /** 获取支持的导入格式列表 */
  getSupportedFormats(): Promise<FormatInfo[]>

  /** 导入 Demo 数据 */
  importDemo(locale: string, onProgress?: (p: DemoProgress) => void): Promise<DemoImportResult>

  /** 分析增量导入（预览去重后可新增多少消息） */
  analyzeIncrementalImport(sessionId: string, file: File | string): Promise<IncrementalAnalysis>

  /** 执行增量导入 */
  incrementalImport(
    sessionId: string,
    file: File | string,
    onProgress?: (p: ImportProgress) => void
  ): Promise<IncrementalImportResult>

  /** 导入目录（多文件格式如 chunked-jsonl）。Electron 传目录路径，Web 传 File[]（含 webkitRelativePath） */
  importDirectory(
    source: File[] | string,
    options?: ImportOptions,
    onProgress?: (p: ImportProgress) => void
  ): Promise<ImportResult>
}

export type { ImportProgress }
