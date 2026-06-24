/**
 * Unified application logger (platform-agnostic, Node side).
 *
 * Shared by Electron main process, CLI and CLI Web runtime. Writes general
 * application/diagnostic logs to a single rolling file `<logsDir>/app.log`.
 *
 * Scope of this logger: general app + key-path + crash logs. AI logs (AiLogger)
 * and import perf logs keep their own per-scenario files.
 */

import * as fs from 'fs'
import * as path from 'path'
import { extractErrorInfo, extractErrorStack } from '../ai/ai-logger'

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

const LEVEL_ORDER: Record<LogLevel, number> = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 }

// Rotate when app.log reaches this size; old content moves to app.old.log.
const MAX_SIZE_BYTES = 10 * 1024 * 1024 // 10MB

class AppLogger {
  private logFile: string
  private oldLogFile: string
  private threshold: LogLevel

  constructor(logsDir: string) {
    this.logFile = path.join(logsDir, 'app.log')
    this.oldLogFile = path.join(logsDir, 'app.old.log')
    this.threshold = resolveThreshold()
  }

  debug(scope: string, message: string, data?: unknown): void {
    this.write('DEBUG', scope, message, data)
  }

  info(scope: string, message: string, data?: unknown): void {
    this.write('INFO', scope, message, data)
  }

  warn(scope: string, message: string, data?: unknown): void {
    this.write('WARN', scope, message, data)
  }

  /** `data` may be an Error; its name/message/stack are extracted automatically. */
  error(scope: string, message: string, data?: unknown): void {
    this.write('ERROR', scope, message, data)
  }

  getLogPath(): string {
    return this.logFile
  }

  private write(level: LogLevel, scope: string, message: string, data?: unknown): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.threshold]) return

    let line = `[${new Date().toISOString()}] [${level}] [${scope}] ${message}`
    const tail = formatData(data)
    if (tail) line += `\n${tail}`
    line += '\n'

    try {
      ensureDir(path.dirname(this.logFile))
      this.rotateIfNeeded()
      fs.appendFileSync(this.logFile, line, 'utf-8')
    } catch (err) {
      // Logging must never break the app; surface to console only.
      console.error('[AppLogger] Failed to write log:', err)
    }
  }

  // ponytail: rename-based rotation, atomic, no rewrite, ~20MB total ceiling
  private rotateIfNeeded(): void {
    let size = 0
    try {
      size = fs.statSync(this.logFile).size
    } catch {
      return // file doesn't exist yet
    }
    if (size < MAX_SIZE_BYTES) return
    fs.renameSync(this.logFile, this.oldLogFile) // overwrites previous .old, atomic
  }
}

function resolveThreshold(): LogLevel {
  const raw = (process.env.CHATLAB_LOG_LEVEL || '').toUpperCase()
  if (raw === 'DEBUG' || raw === 'INFO' || raw === 'WARN' || raw === 'ERROR') return raw
  return 'INFO'
}

function formatData(data: unknown): string {
  if (data === undefined) return ''
  if (data instanceof Error) {
    const info = extractErrorInfo(data)
    const stack = extractErrorStack(data)
    return JSON.stringify(info) + (stack ? `\n${stack}` : '')
  }
  if (typeof data === 'string') return data
  try {
    return JSON.stringify(data)
  } catch {
    return '[unserializable data]'
  }
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

let instance: AppLogger | null = null

/** Initialize the singleton app logger. Call once per runtime at startup. */
export function initAppLogger(logsDir: string): void {
  instance = new AppLogger(logsDir)
}

/**
 * The shared logger. Safe to call before init: logs are dropped silently until
 * `initAppLogger` runs (avoids ordering hazards at very early startup).
 */
export const appLogger = {
  debug: (scope: string, message: string, data?: unknown) => instance?.debug(scope, message, data),
  info: (scope: string, message: string, data?: unknown) => instance?.info(scope, message, data),
  warn: (scope: string, message: string, data?: unknown) => instance?.warn(scope, message, data),
  error: (scope: string, message: string, data?: unknown) => instance?.error(scope, message, data),
  getLogPath: () => instance?.getLogPath() ?? null,
}
