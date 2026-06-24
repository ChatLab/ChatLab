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
import { t } from '../i18n'
import { getArchiveImportSourceManager, importPreparedChatWithSource } from '../import-source-runtime'

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

  ipcMain.handle('chat:prepareImportSource', async (_, filePath: string) => {
    try {
      const source = await getArchiveImportSourceManager().prepareLocalArchive(filePath)
      return { success: true, source }
    } catch (error) {
      return {
        success: false,
        error:
          error && typeof error === 'object' && 'code' in error
            ? String(error.code)
            : error instanceof Error
              ? error.message
              : String(error),
      }
    }
  })

  ipcMain.handle('chat:importPreparedChat', async (_, sourceId: string, chatId: string) => {
    try {
      const result = await importPreparedChatWithSource(
        getArchiveImportSourceManager(),
        sourceId,
        chatId,
        (manifestPath) =>
          worker.streamImport(
            manifestPath,
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
            { formatId: 'google-chat-takeout' }
          )
      )
      return {
        success: result.success,
        sessionId: result.sessionId,
        error: result.error,
        diagnostics: result.diagnostics,
      }
    } catch (error) {
      return {
        success: false,
        error:
          error && typeof error === 'object' && 'code' in error
            ? String(error.code)
            : error instanceof Error
              ? error.message
              : String(error),
      }
    }
  })

  ipcMain.handle('chat:releaseImportSource', async (_, sourceId: string) => {
    await getArchiveImportSourceManager().release(sourceId)
    return { success: true }
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
        // 分析缓存按 DB 文件版本自动失效，无需手动清理
        // 通知渲染进程刷新会话列表（与 API 路由的 notifySessionListChanged 保持一致）
        win.webContents.send('api:importCompleted')
      }

      return result
    } catch (error) {
      console.error('[IpcMain] Failed to execute incremental import:', error)
      return { success: false, error: String(error) }
    }
  })

  // Session index and summary IPC handlers have been removed.
  // All session-index operations now go through shared HTTP routes
  // (FetchSessionIndexAdapter via /_web/sessions/* endpoints).
}
