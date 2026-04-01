/**
 * 简单的日志工具
 * 日志保存到 userData/logs/ 目录
 */

import * as fs from 'fs'
import * as path from 'path'
import { getLogsDir, ensureDir } from './paths'

// 日志目录
function getLogDir(): string {
  return getLogsDir()
}

// 日志文件路径
function getLogPath(): string {
  return path.join(getLogDir(), 'app.log')
}

// 确保日志目录存在
function ensureLogDir(): void {
  ensureDir(getLogDir())
}

// 格式化时间
function formatTime(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const hour = String(now.getHours()).padStart(2, '0')
  const minute = String(now.getMinutes()).padStart(2, '0')
  const second = String(now.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`
}

// 写入日志
function writeLog(level: string, message: string): void {
  try {
    ensureLogDir()
    const logLine = `[${formatTime()}] [${level}] ${message}\n`
    fs.appendFileSync(getLogPath(), logLine, 'utf-8')
  } catch (error) {
    // 日志写入失败时静默处理，避免影响主程序
    console.error('[Logger] Failed to write log:', error)
  }
}

/**
 * 日志工具
 */
export const logger = {
  info: (message: string) => writeLog('INFO', message),
  warn: (message: string) => writeLog('WARN', message),
  error: (message: string) => writeLog('ERROR', message),
  debug: (message: string) => writeLog('DEBUG', message),
}
