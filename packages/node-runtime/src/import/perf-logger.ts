/**
 * Import performance logger.
 *
 * Each import must own an independent logger instance because batch imports can
 * run concurrently in the same process.
 */

import * as fs from 'fs'
import * as path from 'path'

export enum LogLevel {
  ERROR = 'ERROR',
  INFO = 'INFO',
}

export interface ImportPerfLogger {
  info(message: string): void
  error(message: string, error?: Error): void
  perf(event: string, messagesProcessed: number, batchSize?: number): void
  perfDetail(detail: string): void
  summary(totalMessages: number, totalMembers: number): void
  reset(): void
  init(sessionId: string): void
  getCurrentLogFile(): string | null
  getErrorCount(): number
}

export function createImportPerfLogger(logDir: string): ImportPerfLogger {
  let lastLogTime = Date.now()
  let lastMessageCount = 0
  let currentLogFile: string | null = null
  let errorCount = 0

  const append = (line: string) => {
    if (!currentLogFile) return
    try {
      fs.appendFileSync(currentLogFile, line, 'utf-8')
    } catch {
      // Ignore write failure.
    }
  }

  const writeLogLine = (level: LogLevel, message: string) => {
    append(`[${new Date().toISOString()}] [${level}] ${message}\n`)
  }

  return {
    init(sessionId) {
      try {
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true })
        currentLogFile = path.join(logDir, `import_${sessionId}_${Date.now()}.log`)
        fs.writeFileSync(currentLogFile, `=== Import Log ===\nStart time: ${new Date().toISOString()}\n\n`, 'utf-8')
      } catch {
        currentLogFile = null
      }
    },
    perf(event, messagesProcessed, batchSize) {
      const now = Date.now()
      const duration = now - lastLogTime
      const messagesDelta = messagesProcessed - lastMessageCount
      const speed = duration > 0 ? Math.round((messagesDelta / duration) * 1000) : 0
      let memory = 0
      try {
        memory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
      } catch {
        // Ignore memory sampling failure.
      }
      append(
        `[${new Date().toISOString()}] ${event} | ` +
          `messages: ${messagesProcessed.toLocaleString()} | ` +
          `elapsed: ${duration}ms | ` +
          `speed: ${speed.toLocaleString()}/s | ` +
          `memory: ${memory}MB` +
          (batchSize ? ` | batch: ${batchSize}` : '') +
          '\n'
      )
      lastLogTime = now
      lastMessageCount = messagesProcessed
    },
    perfDetail(detail) {
      append(`  ${detail}\n`)
    },
    reset() {
      lastLogTime = Date.now()
      lastMessageCount = 0
      currentLogFile = null
      errorCount = 0
    },
    getCurrentLogFile() {
      return currentLogFile
    },
    error(message, error) {
      errorCount++
      writeLogLine(LogLevel.ERROR, `${message}${error ? `: ${error.message}` : ''}`)
    },
    info(message) {
      writeLogLine(LogLevel.INFO, message)
    },
    getErrorCount() {
      return errorCount
    },
    summary(totalMessages, totalMembers) {
      append(`
=== Import Summary ===
End time: ${new Date().toISOString()}
Total messages: ${totalMessages.toLocaleString()}
Total members: ${totalMembers.toLocaleString()}
Errors: ${errorCount}
`)
    },
  }
}

let defaultLogger = createImportPerfLogger('')

export function initPerfLog(sessionId: string, logDir: string): void {
  defaultLogger = createImportPerfLogger(logDir)
  defaultLogger.init(sessionId)
}

export function logPerf(event: string, messagesProcessed: number, batchSize?: number): void {
  defaultLogger.perf(event, messagesProcessed, batchSize)
}

export function logPerfDetail(detail: string): void {
  defaultLogger.perfDetail(detail)
}

export function resetPerfLog(): void {
  defaultLogger.reset()
}

export function getCurrentLogFile(): string | null {
  return defaultLogger.getCurrentLogFile()
}

export function logError(message: string, error?: Error): void {
  defaultLogger.error(message, error)
}

export function logInfo(message: string): void {
  defaultLogger.info(message)
}

export function getErrorCount(): number {
  return defaultLogger.getErrorCount()
}

export function logSummary(totalMessages: number, totalMembers: number): void {
  defaultLogger.summary(totalMessages, totalMembers)
}
