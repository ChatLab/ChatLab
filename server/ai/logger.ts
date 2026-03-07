/**
 * AI logging module (server-side)
 * Writes AI-related operation logs to local files.
 */

import * as fs from 'fs'
import * as path from 'path'
import { getLogsDir, ensureDir } from '../paths.js'

let debugMode = false

export function setDebugMode(enabled: boolean): void {
  debugMode = enabled
}

export function isDebugMode(): boolean {
  return debugMode
}

// Log directory & file state
let LOG_DIR: string | null = null
let LOG_FILE: string | null = null
let logStream: fs.WriteStream | null = null

function getLogDir(): string {
  if (LOG_DIR) return LOG_DIR
  LOG_DIR = path.join(getLogsDir(), 'ai')
  return LOG_DIR
}

function ensureLogDir(): void {
  const dir = getLogDir()
  ensureDir(dir)
}

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

function getExistingLogPath(): string | null {
  if (LOG_FILE && fs.existsSync(LOG_FILE)) {
    return LOG_FILE
  }
  return null
}

function getLogStream(): fs.WriteStream {
  if (logStream) return logStream

  const filePath = getLogFilePath()
  logStream = fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf-8' })

  return logStream
}

function formatTimestamp(): string {
  return new Date().toISOString()
}

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

function writeLog(level: LogLevel, category: string, message: string, data?: unknown, toConsole: boolean = false): void {
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

  try {
    const stream = getLogStream()
    stream.write(logLine)
  } catch (error) {
    console.error('[AILogger] Failed to write log:', error)
  }

  if (toConsole || level === 'WARN' || level === 'ERROR') {
    console.log(`[AI] ${message}`)
  }
}

/**
 * AI logger object
 */
export const aiLogger = {
  debug(category: string, message: string, data?: unknown) {
    writeLog('DEBUG', category, message, data)
  },

  info(category: string, message: string, data?: unknown) {
    writeLog('INFO', category, message, data)
  },

  warn(category: string, message: string, data?: unknown) {
    writeLog('WARN', category, message, data)
  },

  error(category: string, message: string, data?: unknown) {
    writeLog('ERROR', category, message, data)
  },

  close() {
    if (logStream) {
      logStream.end()
      logStream = null
    }
  },

  getLogPath(): string {
    return getLogFilePath()
  },

  getExistingLogPath(): string | null {
    return getExistingLogPath()
  },
}

/**
 * Extract error info (without stack) from an Error object.
 */
export function extractErrorInfo(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const info: Record<string, unknown> = {
      name: error.name,
      message: error.message,
    }
    if ('cause' in error && error.cause) {
      info.cause = extractErrorInfo(error.cause)
    }
    return info
  }
  if (typeof error === 'object' && error !== null) {
    return { raw: JSON.stringify(error) }
  }
  return { message: String(error) }
}

/**
 * Extract stack trace from an Error object.
 */
export function extractErrorStack(error: unknown, stackLines: number = 5): string | null {
  if (error instanceof Error && error.stack) {
    const lines = error.stack.split('\n')
    return lines.slice(1, stackLines + 1).join('\n')
  }
  return null
}

// Convenience exports
export function logAI(message: string, data?: unknown) {
  aiLogger.info('AI', message, data)
}

export function logLLM(message: string, data?: unknown) {
  aiLogger.info('LLM', message, data)
}

export function logSearch(message: string, data?: unknown) {
  aiLogger.info('Search', message, data)
}

export function logRAG(message: string, data?: unknown) {
  aiLogger.info('RAG', message, data)
}
