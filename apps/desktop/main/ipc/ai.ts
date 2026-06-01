/**
 * AI IPC handlers — Electron-only subset
 *
 * Most AI functionality has been migrated to shared HTTP/SSE routes.
 * This file retains only: debug mode toggle + native shell log file opening.
 */
import { ipcMain, shell } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { aiLogger, setDebugMode } from '../ai/logger'
import { getLogsDir } from '../paths'
import * as assistantManager from '../ai/assistant'
import * as skillManager from '../ai/skills'
import type { IpcContext } from './types'

export function registerAIHandlers(_ctx: IpcContext): void {
  console.log('[IPC] Registering AI handlers...')

  try {
    assistantManager.initAssistantManager()
    console.log('[IPC] Assistant manager initialized')
  } catch (error) {
    console.error('[IPC] Failed to initialize assistant manager:', error)
  }

  try {
    skillManager.initSkillManager()
    console.log('[IPC] Skill manager initialized')
  } catch (error) {
    console.error('[IPC] Failed to initialize skill manager:', error)
  }

  // ==================== Debug 模式 ====================

  ipcMain.on('app:setDebugMode', (_, enabled: boolean) => {
    setDebugMode(enabled)
    aiLogger.info('Config', `Debug mode ${enabled ? 'enabled' : 'disabled'}`)
  })

  // ==================== AI 日志 ====================

  ipcMain.handle('ai:showLogFile', async () => {
    try {
      const existingLogPath = aiLogger.getExistingLogPath()
      if (existingLogPath) {
        shell.showItemInFolder(existingLogPath)
        return { success: true, path: existingLogPath }
      }

      const logDir = path.join(getLogsDir(), 'ai')
      if (!fs.existsSync(logDir)) {
        return { success: false, error: 'No AI log files found' }
      }

      const logFiles = fs.readdirSync(logDir).filter((name) => name.startsWith('ai_') && name.endsWith('.log'))

      if (logFiles.length === 0) {
        return { success: false, error: 'No AI log files found' }
      }

      const latestLog = logFiles
        .map((name) => {
          const filePath = path.join(logDir, name)
          const stat = fs.statSync(filePath)
          return { path: filePath, mtimeMs: stat.mtimeMs }
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]

      shell.showItemInFolder(latestLog.path)
      return { success: true, path: latestLog.path }
    } catch (error) {
      console.error('Failed to open AI log file:', error)
      return { success: false, error: String(error) }
    }
  })

  // Desensitize rules, LLM chat, estimateContextTokens, tool testing
  // have all been migrated to shared HTTP routes.
}
