/**
 * AI 日志模块
 * 将 AI 相关操作日志写入本地文件
 */

import * as fs from 'fs'
import * as path from 'path'
import { getLogsDir } from '../paths'

let debugMode = false

export function setDebugMode(enabled: boolean): void {
  debugMode = enabled
}

export function isDebugMode(): boolean {
  return debugMode
}

// 日志目录
let LOG_DIR: string | null = null
let LOG_FILE: string | null = null
let logStream: fs.WriteStream | null = null

/**
 * 获取日志目录
 */
function getLogDir(): string {
  if (LOG_DIR) return LOG_DIR
  LOG_DIR = path.join(getLogsDir(), 'ai')
  return LOG_DIR
}

/**
 * 确保日志目录存在
 */
function ensureLogDir(): void {
  const dir = getLogDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/**
 * 获取当前日志文件路径
 * 日志文件名格式：ai_YYYY-MM-DD_HH-mm.log
 */
function getLogFilePath(): string {
  if (LOG_FILE) return LOG_FILE

  ensureLogDir()
  const now = new Date()
  const date = now.toISOString().split('T')[0]
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  LOG_FILE = path.join(getLogDir(), `ai_${date}_${hours}-${minutes}.log`)

  return LOG_FILE
}

/**
 * 获取已存在的日志文件路径（不会创建新文件）
 */
function getExistingLogPath(): string | null {
  if (LOG_FILE && fs.existsSync(LOG_FILE)) {
    return LOG_FILE
  }
  return null
}

/**
 * 获取日志写入流
 */
function getLogStream(): fs.WriteStream {
  if (logStream) return logStream

  const filePath = getLogFilePath()
  logStream = fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf-8' })

  return logStream
}

/**
 * 格式化时间戳
 */
function formatTimestamp(): string {
  return new Date().toISOString()
}

/**
 * 日志级别
 */
type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

/**
 * 写入日志
 * @param level 日志级别
 * @param category 分类
 * @param message 消息
 * @param data 附加数据
 * @param toConsole 是否输出到控制台（默认只有 WARN/ERROR 输出）
 */
function writeLog(level: LogLevel, category: string, message: string, data?: any, toConsole: boolean = false): void {
  const timestamp = formatTimestamp()
  let logLine = `[${timestamp}] [${level}] [${category}] ${message}`

  if (data !== undefined) {
    try {
      const dataStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
      if (!debugMode && dataStr.length > 2000) {
        logLine += `\n${dataStr.slice(0, 2000)}...[truncated, ${dataStr.length} chars total]`
      } else {
        logLine += `\n${dataStr}`
      }
    } catch {
      logLine += `\n[unserializable data]`
    }
  }

  logLine += '\n'

  // 写入文件
  try {
    const stream = getLogStream()
    stream.write(logLine)
  } catch (error) {
    console.error('[AILogger] Failed to write log:', error)
  }

  // 只在需要时输出到控制台（WARN/ERROR 或明确指定）
  if (toConsole || level === 'WARN' || level === 'ERROR') {
    console.log(`[AI] ${message}`)
  }
}

/**
 * AI 日志对象
 */
export const aiLogger = {
  debug(category: string, message: string, data?: any) {
    writeLog('DEBUG', category, message, data)
  },

  info(category: string, message: string, data?: any) {
    writeLog('INFO', category, message, data)
  },

  warn(category: string, message: string, data?: any) {
    writeLog('WARN', category, message, data)
  },

  error(category: string, message: string, data?: any) {
    writeLog('ERROR', category, message, data)
  },

  /**
   * 关闭日志流
   */
  close() {
    if (logStream) {
      logStream.end()
      logStream = null
    }
  },

  /**
   * 获取日志文件路径
   */
  getLogPath(): string {
    return getLogFilePath()
  },

  /**
   * 获取已存在的日志文件路径（无日志时返回空）
   */
  getExistingLogPath(): string | null {
    return getExistingLogPath()
  },
}

/**
 * 从 Error 对象中提取错误信息（不含堆栈）
 * @param error 任意错误对象
 */
export function extractErrorInfo(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const info: Record<string, unknown> = {
      name: error.name,
      message: error.message,
    }

    // 如果有 cause，递归提取
    if ('cause' in error && error.cause) {
      info.cause = extractErrorInfo(error.cause)
    }

    return info
  }

  // 非 Error 对象，尝试转换
  if (typeof error === 'object' && error !== null) {
    return { raw: JSON.stringify(error) }
  }

  return { message: String(error) }
}

/**
 * 从 Error 对象中提取堆栈信息（用于单独一行日志）
 * @param error 任意错误对象
 * @param stackLines 保留的堆栈行数（默认 5）
 */
export function extractErrorStack(error: unknown, stackLines: number = 5): string | null {
  if (error instanceof Error && error.stack) {
    const lines = error.stack.split('\n')
    // 跳过第一行（错误消息），保留后续 N 行堆栈
    return lines.slice(1, stackLines + 1).join('\n')
  }
  return null
}

// 导出便捷函数
export function logAI(message: string, data?: any) {
  aiLogger.info('AI', message, data)
}

export function logLLM(message: string, data?: any) {
  aiLogger.info('LLM', message, data)
}

export function logSearch(message: string, data?: any) {
  aiLogger.info('Search', message, data)
}

export function logRAG(message: string, data?: any) {
  aiLogger.info('RAG', message, data)
}
