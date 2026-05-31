/**
 * 聊天记录导入、迁移与摘要 IPC 处理器
 *
 * 数据查询/分析/成员管理/SQL/会话索引等业务已迁移到
 * Internal HTTP Server (@openchatlab/http-routes)。
 * 本文件仅保留：数据库迁移、文件导入、摘要生成、临时导出。
 */

import { ipcMain, app, dialog } from 'electron'
import * as databaseCore from '../database/core'
import * as worker from '../worker/workerManager'
import { detectFormat, findEntryFileInDirectory, scanMultiChatFile, type ParseProgress } from '../parser'
import * as parser from '../parser'
import type { IpcContext } from './types'
import { CURRENT_SCHEMA_VERSION, getPendingMigrationInfos } from '../database/migrations'
import { exportSessionToTempFile, cleanupTempExportFiles } from '../merger'
import { t } from '../i18n'

export function registerChatHandlers(ctx: IpcContext): void {
  const { win } = ctx

  // ==================== 数据库迁移 ====================

  ipcMain.handle('chat:checkMigration', async () => {
    try {
      const result = databaseCore.checkMigrationNeeded()
      const pendingMigrations = getPendingMigrationInfos(result.lowestVersion)
      return {
        needsMigration: result.count > 0,
        count: result.count,
        currentVersion: CURRENT_SCHEMA_VERSION,
        pendingMigrations,
      }
    } catch (error) {
      console.error('[IpcMain] Migration check failed:', error)
      return { needsMigration: false, count: 0, currentVersion: CURRENT_SCHEMA_VERSION, pendingMigrations: [] }
    }
  })

  ipcMain.handle('chat:runMigration', async () => {
    try {
      return databaseCore.migrateAllDatabases()
    } catch (error) {
      console.error('[IpcMain] Migration execution failed:', error)
      return { success: false, migratedCount: 0, error: String(error) }
    }
  })

  // ==================== 文件选择与格式检测 ====================

  ipcMain.handle('chat:selectFile', async () => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: t('dialog.selectChatFile'),
        defaultPath: app.getPath('documents'),
        properties: ['openFile'],
        filters: [
          { name: t('dialog.chatRecords'), extensions: ['json', 'jsonl', 'txt'] },
          { name: t('dialog.allFiles'), extensions: ['*'] },
        ],
        buttonLabel: t('dialog.import'),
      })

      if (canceled || filePaths.length === 0) return null

      const filePath = filePaths[0]
      const formatFeature = detectFormat(filePath)
      const format = formatFeature?.name || null
      if (!format) return { error: 'error.unrecognized_format' }

      return { filePath, format }
    } catch (error) {
      console.error('[IpcMain] Error selecting file:', error)
      return { error: String(error) }
    }
  })

  ipcMain.handle('chat:detectFormat', async (_, filePath: string) => {
    try {
      const formatFeature = detectFormat(filePath)
      if (!formatFeature) return null
      return {
        id: formatFeature.id,
        name: formatFeature.name,
        platform: formatFeature.platform,
        multiChat: formatFeature.multiChat || false,
      }
    } catch {
      return null
    }
  })

  ipcMain.handle('chat:scanMultiChatFile', async (_, filePath: string) => {
    try {
      const chats = await scanMultiChatFile(filePath)
      return { success: true, chats }
    } catch (error) {
      console.error('[IpcMain] Failed to scan multi-chat files:', error)
      return { success: false, error: String(error), chats: [] }
    }
  })

  ipcMain.handle('chat:getSupportedFormats', async () => {
    return parser.getSupportedFormats()
  })

  // ==================== 导入 ====================

  ipcMain.handle('chat:import', async (_, filePath: string) => {
    try {
      win.webContents.send('chat:importProgress', { stage: 'detecting', progress: 5, message: '' })

      const result = await worker.streamImport(filePath, (progress: ParseProgress) => {
        win.webContents.send('chat:importProgress', {
          stage: progress.stage,
          progress: progress.percentage,
          message: progress.message,
          bytesRead: progress.bytesRead,
          totalBytes: progress.totalBytes,
          messagesProcessed: progress.messagesProcessed,
        })
      })

      if (result.success) {
        return { success: true, sessionId: result.sessionId, diagnostics: result.diagnostics }
      } else {
        win.webContents.send('chat:importProgress', { stage: 'error', progress: 0, message: result.error })
        return { success: false, error: result.error, diagnostics: result.diagnostics }
      }
    } catch (error) {
      win.webContents.send('chat:importProgress', { stage: 'error', progress: 0, message: String(error) })
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('chat:importDirectory', async (_, dirPath: string) => {
    try {
      const entryPath = findEntryFileInDirectory(dirPath)
      if (!entryPath) return { success: false, error: 'No recognizable import format found in directory' }

      win.webContents.send('chat:importProgress', { stage: 'detecting', progress: 5, message: '' })

      const result = await worker.streamImport(entryPath, (progress: ParseProgress) => {
        win.webContents.send('chat:importProgress', {
          stage: progress.stage,
          progress: progress.percentage,
          message: progress.message,
          bytesRead: progress.bytesRead,
          totalBytes: progress.totalBytes,
          messagesProcessed: progress.messagesProcessed,
        })
      })

      if (result.success) {
        return { success: true, sessionId: result.sessionId, diagnostics: result.diagnostics }
      } else {
        win.webContents.send('chat:importProgress', { stage: 'error', progress: 0, message: result.error })
        return { success: false, error: result.error, diagnostics: result.diagnostics }
      }
    } catch (error) {
      win.webContents.send('chat:importProgress', { stage: 'error', progress: 0, message: String(error) })
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('chat:importWithOptions', async (_, filePath: string, formatOptions: Record<string, unknown>) => {
    try {
      win.webContents.send('chat:importProgress', { stage: 'detecting', progress: 5, message: '' })

      const result = await worker.streamImport(
        filePath,
        (progress: ParseProgress) => {
          win.webContents.send('chat:importProgress', {
            stage: progress.stage,
            progress: progress.percentage,
            message: progress.message,
            bytesRead: progress.bytesRead,
            totalBytes: progress.totalBytes,
            messagesProcessed: progress.messagesProcessed,
          })
        },
        formatOptions
      )

      if (result.success) {
        return { success: true, sessionId: result.sessionId, diagnostics: result.diagnostics }
      } else {
        win.webContents.send('chat:importProgress', { stage: 'error', progress: 0, message: result.error })
        return { success: false, error: result.error, diagnostics: result.diagnostics }
      }
    } catch (error) {
      win.webContents.send('chat:importProgress', { stage: 'error', progress: 0, message: String(error) })
      return { success: false, error: String(error) }
    }
  })

  // ==================== 增量导入 ====================

  ipcMain.handle('chat:analyzeIncrementalImport', async (_, sessionId: string, filePath: string) => {
    try {
      const formatFeature = detectFormat(filePath)
      if (!formatFeature) return { error: 'error.unrecognized_format' }
      return await worker.analyzeIncrementalImport(sessionId, filePath)
    } catch (error) {
      console.error('[IpcMain] Failed to analyze incremental import:', error)
      return { error: String(error) }
    }
  })

  ipcMain.handle('chat:incrementalImport', async (_, sessionId: string, filePath: string) => {
    try {
      win.webContents.send('chat:importProgress', { stage: 'saving', progress: 0, message: '' })

      const result = await worker.incrementalImport(sessionId, filePath, (progress) => {
        win.webContents.send('chat:importProgress', {
          stage: progress.stage,
          progress: progress.percentage,
          message: progress.message,
        })
      })

      if (result.success) {
        try {
          await worker.generateIncrementalSessions(sessionId)
        } catch (e) {
          console.error('[IpcMain] Failed to incrementally generate session index:', e)
        }
        worker.invalidateAnalysisCache(sessionId).catch(() => {})
      }

      return result
    } catch (error) {
      console.error('[IpcMain] Failed to execute incremental import:', error)
      return { success: false, error: String(error) }
    }
  })

  // ==================== 会话索引（ElectronSessionIndexAdapter 依赖） ====================

  ipcMain.handle('session:generate', async (_, sessionId: string, gapThreshold?: number) => {
    try {
      return await worker.generateSessions(sessionId, gapThreshold)
    } catch (error) {
      console.error('Failed to generate session index:', error)
      throw error
    }
  })

  ipcMain.handle('session:generateIncremental', async (_, sessionId: string, gapThreshold?: number) => {
    try {
      return await worker.generateIncrementalSessions(sessionId, gapThreshold)
    } catch (error) {
      console.error('Failed to generate incremental session index:', error)
      throw error
    }
  })

  ipcMain.handle('session:hasIndex', async (_, sessionId: string) => {
    try {
      return await worker.hasSessionIndex(sessionId)
    } catch (error) {
      console.error('Failed to check session index:', error)
      return false
    }
  })

  ipcMain.handle('session:getStats', async (_, sessionId: string) => {
    try {
      return await worker.getSessionStats(sessionId)
    } catch (error) {
      console.error('Failed to get session stats:', error)
      return { sessionCount: 0, hasIndex: false, gapThreshold: 1800 }
    }
  })

  ipcMain.handle('session:getAllIndexStats', async () => {
    try {
      return await worker.getAllIndexStats()
    } catch (error) {
      console.error('Failed to get all index stats:', error)
      return []
    }
  })

  ipcMain.handle('session:clear', async (_, sessionId: string) => {
    try {
      await worker.clearSessions(sessionId)
      return true
    } catch (error) {
      console.error('Failed to clear session index:', error)
      return false
    }
  })

  ipcMain.handle('session:updateGapThreshold', async (_, sessionId: string, gapThreshold: number | null) => {
    try {
      await worker.updateSessionGapThreshold(sessionId, gapThreshold)
      return true
    } catch (error) {
      console.error('Failed to update threshold:', error)
      return false
    }
  })

  ipcMain.handle('session:getSessions', async (_, sessionId: string) => {
    try {
      return await worker.getSessions(sessionId)
    } catch (error) {
      console.error('Failed to get session list:', error)
      return []
    }
  })

  ipcMain.handle('session:getByTimeRange', async (_, dbSessionId: string, startTs: number, endTs: number) => {
    try {
      return await worker.getSessionsByTimeRange(dbSessionId, startTs, endTs)
    } catch (error) {
      console.error('Failed to query sessions by time range:', error)
      return []
    }
  })

  ipcMain.handle('session:getRecent', async (_, dbSessionId: string, limit: number) => {
    try {
      return await worker.getRecentChatSessions(dbSessionId, limit)
    } catch (error) {
      console.error('Failed to query recent sessions:', error)
      return []
    }
  })

  // ==================== 会话摘要（依赖 LLM，无共享路由） ====================

  ipcMain.handle(
    'session:generateSummary',
    async (
      _,
      dbSessionId: string,
      chatSessionId: number,
      locale?: string,
      forceRegenerate?: boolean,
      strategy?: 'brief' | 'standard'
    ) => {
      try {
        const { generateSessionSummary } = await import('../ai/summary')
        return await generateSessionSummary(
          dbSessionId,
          chatSessionId,
          locale || 'zh-CN',
          forceRegenerate || false,
          strategy
        )
      } catch (error) {
        console.error('[IPC] Failed to generate session summary:', error)
        return { success: false, error: String(error) }
      }
    }
  )

  ipcMain.handle(
    'session:generateSummaries',
    async (_, dbSessionId: string, chatSessionIds: number[], locale?: string) => {
      try {
        const { generateSessionSummaries } = await import('../ai/summary')
        return await generateSessionSummaries(dbSessionId, chatSessionIds, locale || 'zh-CN')
      } catch (error) {
        console.error('Failed to batch generate session summaries:', error)
        return { success: 0, failed: chatSessionIds.length, skipped: 0 }
      }
    }
  )

  ipcMain.handle('session:checkCanGenerateSummary', async (_, dbSessionId: string, chatSessionIds: number[]) => {
    try {
      const { checkSessionsCanGenerateSummary } = await import('../ai/summary')
      const results = checkSessionsCanGenerateSummary(dbSessionId, chatSessionIds)
      const obj: Record<number, { canGenerate: boolean; reason?: string }> = {}
      for (const [id, result] of results) {
        obj[id] = result
      }
      return obj
    } catch (error) {
      console.error('Failed to batch check session summaries:', error)
      return {}
    }
  })

  // ==================== 临时导出（合并用） ====================

  ipcMain.handle('chat:exportSessionsToTempFiles', async (_, sessionIds: string[]) => {
    try {
      const tempFiles: string[] = []
      for (const sessionId of sessionIds) {
        const tempPath = await exportSessionToTempFile(sessionId)
        tempFiles.push(tempPath)
      }
      return { success: true, tempFiles }
    } catch (error) {
      console.error('[IpcMain] Failed to export session:', error)
      return { success: false, error: String(error), tempFiles: [] }
    }
  })

  ipcMain.handle('chat:cleanupTempExportFiles', async (_, filePaths: string[]) => {
    try {
      cleanupTempExportFiles(filePaths)
      return { success: true }
    } catch (error) {
      console.error('[IpcMain] Failed to clean up temp files:', error)
      return { success: false, error: String(error) }
    }
  })
}
