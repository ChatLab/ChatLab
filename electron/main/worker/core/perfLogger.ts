/**
 * 导入日志模块
 * 实时记录导入过程的性能指标、错误和警告信息
 */

import * as fs from 'fs'
import * as path from 'path'
import { getDbDir } from './dbCore'

// 日志级别
export enum LogLevel {
  ERROR = 'ERROR',
  INFO = 'INFO',
}

// 状态
let lastLogTime = Date.now()
let lastMessageCount = 0
let currentLogFile: string | null = null

// 统计计数器
let errorCount = 0

/**
 * 获取性能日志目录
 */
function getLogDir(): string {
  const dbDir = getDbDir()
  const logDir = path.join(path.dirname(dbDir), 'logs', 'import')
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true })
  }
  return logDir
}

/**
 * 初始化日志文件（实时写入）
 */
export function initPerfLog(sessionId: string): void {
  try {
    const logDir = getLogDir()
    currentLogFile = path.join(logDir, `import_${sessionId}_${Date.now()}.log`)
    // 写入头部
    fs.writeFileSync(currentLogFile, `=== Import Log ===\nStart time: ${new Date().toISOString()}\n\n`, 'utf-8')
  } catch {
    // 忽略初始化失败
  }
}

/**
 * 实时记录性能日志（每次追加写入文件）
 */
export function logPerf(event: string, messagesProcessed: number, batchSize?: number): void {
  const now = Date.now()
  const duration = now - lastLogTime
  const messagesDelta = messagesProcessed - lastMessageCount
  const speed = duration > 0 ? Math.round((messagesDelta / duration) * 1000) : 0

  // 获取内存使用
  let memory = 0
  try {
    const used = process.memoryUsage()
    memory = Math.round(used.heapUsed / 1024 / 1024)
  } catch {
    // 忽略
  }

  const logLine =
    `[${new Date().toISOString()}] ${event} | ` +
    `messages: ${messagesProcessed.toLocaleString()} | ` +
    `elapsed: ${duration}ms | ` +
    `speed: ${speed.toLocaleString()}/s | ` +
    `memory: ${memory}MB` +
    (batchSize ? ` | batch: ${batchSize}` : '') +
    '\n'

  // 实时写入文件
  if (currentLogFile) {
    try {
      fs.appendFileSync(currentLogFile, logLine, 'utf-8')
    } catch {
      // 忽略写入失败
    }
  }

  lastLogTime = now
  lastMessageCount = messagesProcessed
}

/**
 * 追加详细日志（分阶段耗时）
 */
export function logPerfDetail(detail: string): void {
  if (currentLogFile) {
    try {
      fs.appendFileSync(currentLogFile, `  ${detail}\n`, 'utf-8')
    } catch {
      // 忽略
    }
  }
}

/**
 * 重置性能日志状态
 */
export function resetPerfLog(): void {
  lastLogTime = Date.now()
  lastMessageCount = 0
  currentLogFile = null
  errorCount = 0
}

/**
 * 获取当前日志文件路径
 */
export function getCurrentLogFile(): string | null {
  return currentLogFile
}

// ==================== 通用日志函数 ====================

/**
 * 写入日志行
 */
function writeLogLine(level: LogLevel, message: string): void {
  if (!currentLogFile) return

  const logLine = `[${new Date().toISOString()}] [${level}] ${message}\n`
  try {
    fs.appendFileSync(currentLogFile, logLine, 'utf-8')
  } catch {
    // 忽略写入失败
  }
}

/**
 * 记录错误日志
 * @param message 错误描述
 * @param error 可选的 Error 对象
 */
export function logError(message: string, error?: Error): void {
  errorCount++
  const errorDetail = error ? `: ${error.message}` : ''
  writeLogLine(LogLevel.ERROR, `${message}${errorDetail}`)
}

/**
 * 记录信息日志
 * @param message 信息描述
 */
export function logInfo(message: string): void {
  writeLogLine(LogLevel.INFO, message)
}

/**
 * 获取错误计数
 */
export function getErrorCount(): number {
  return errorCount
}

/**
 * 写入日志摘要（导入完成时调用）
 */
export function logSummary(totalMessages: number, totalMembers: number): void {
  if (!currentLogFile) return

  const summary = `
=== Import Summary ===
End time: ${new Date().toISOString()}
Total messages: ${totalMessages.toLocaleString()}
Total members: ${totalMembers.toLocaleString()}
Errors: ${errorCount}
`
  try {
    fs.appendFileSync(currentLogFile, summary, 'utf-8')
  } catch {
    // 忽略
  }
}
