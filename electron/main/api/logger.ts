/**
 * ChatLab API — Dedicated logger
 * Writes to userData/logs/api.log alongside app.log
 */

import * as fs from 'fs'
import * as path from 'path'
import { getLogsDir, ensureDir } from '../paths'

let headerWritten = false

function getLogPath(): string {
  return path.join(getLogsDir(), 'api.log')
}

function formatPathForLog(filePath: string): string {
  return filePath.replace(/ /g, '\\ ')
}

function ensureHeader(): void {
  if (headerWritten) return
  headerWritten = true
  try {
    const logPath = getLogPath()
    ensureDir(getLogsDir())
    const isNew = !fs.existsSync(logPath) || fs.statSync(logPath).size === 0
    if (isNew) {
      fs.writeFileSync(logPath, `Local Path:  ${formatPathForLog(logPath)}\n\n`, 'utf-8')
    }
  } catch {
    // silent
  }
}

function formatTime(): string {
  const now = new Date()
  const y = now.getFullYear()
  const M = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const h = String(now.getHours()).padStart(2, '0')
  const m = String(now.getMinutes()).padStart(2, '0')
  const s = String(now.getSeconds()).padStart(2, '0')
  return `${y}-${M}-${d} ${h}:${m}:${s}`
}

function write(level: string, message: string, detail?: unknown): void {
  try {
    ensureHeader()
    let line = `[${formatTime()}] [${level}] ${message}`
    if (detail !== undefined) {
      const extra = detail instanceof Error ? detail.stack || detail.message : JSON.stringify(detail)
      line += `  ${extra}`
    }
    line += '\n'
    fs.appendFileSync(getLogPath(), line, 'utf-8')
  } catch {
    // silent — never let logging break the app
  }
}

export const apiLogger = {
  info: (msg: string, detail?: unknown) => write('INFO', msg, detail),
  warn: (msg: string, detail?: unknown) => write('WARN', msg, detail),
  error: (msg: string, detail?: unknown) => write('ERROR', msg, detail),
}
