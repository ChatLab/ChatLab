/**
 * AI IPC handlers — Electron-only subset
 *
 * Most AI functionality has been migrated to shared HTTP/SSE routes.
 * This file retains only the debug mode toggle.
 */
import { ipcMain } from 'electron'
import { aiLogger, setDebugMode } from '../ai/logger'
import * as assistantManager from '../ai/assistant/manager'
import * as skillManager from '../ai/skills/manager'
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

  // Desensitize rules, LLM chat, estimateContextTokens, tool testing
  // have all been migrated to shared HTTP routes.
}
