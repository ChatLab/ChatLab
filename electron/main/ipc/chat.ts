/**
 * 聊天记录导入与分析 IPC 处理器
 */

import { ipcMain, app, dialog } from 'electron'
import { getConversationCountsBySession } from '../ai/conversations'
import * as databaseCore from '../database/core'
import * as worker from '../worker/workerManager'
import * as parser from '../parser'
import { detectFormat, diagnoseFormat, scanMultiChatFile, type ParseProgress } from '../parser'
import type { IpcContext } from './types'
import { CURRENT_SCHEMA_VERSION, getPendingMigrationInfos } from '../database/migrations'
import { exportSessionToTempFile, cleanupTempExportFiles } from '../merger'
import { t } from '../i18n'

/**
 * 注册聊天记录相关 IPC 处理器
 */
export function registerChatHandlers(ctx: IpcContext): void {
  const { win } = ctx

  // ==================== 数据库迁移 ====================

  /**
   * 检查是否需要数据库迁移
   */
  ipcMain.handle('chat:checkMigration', async () => {
    try {
      const result = databaseCore.checkMigrationNeeded()
      // 获取待执行的迁移信息（从最低版本开始）
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

  /**
   * 执行数据库迁移
   */
  ipcMain.handle('chat:runMigration', async () => {
    try {
      const result = databaseCore.migrateAllDatabases()
      return result
    } catch (error) {
      console.error('[IpcMain] Migration execution failed:', error)
      return { success: false, migratedCount: 0, error: String(error) }
    }
  })

  // ==================== 聊天记录导入与分析 ====================

  /**
   * 选择聊天记录文件
   */
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

      if (canceled || filePaths.length === 0) {
        return null
      }

      const filePath = filePaths[0]

      // 检测文件格式（使用流式检测，只读取文件开头）
      const formatFeature = detectFormat(filePath)
      const format = formatFeature?.name || null
      if (!format) {
        // 使用诊断功能获取详细的错误信息
        const diagnosis = diagnoseFormat(filePath)
        // 返回详细的错误信息
        return {
          error: 'error.unrecognized_format',
          diagnosis: {
            suggestion: diagnosis.suggestion,
            partialMatches: diagnosis.partialMatches.map((m) => ({
              formatName: m.formatName,
              missingFields: m.missingFields,
            })),
          },
        }
      }

      return { filePath, format }
    } catch (error) {
      console.error('[IpcMain] Error selecting file:', error)
      return { error: String(error) }
    }
  })

  /**
   * 导入聊天记录（流式版本）
   */
  ipcMain.handle('chat:import', async (_, filePath: string) => {
    try {
      // Send progress: detecting format (message not used by frontend, stage-based translation)
      win.webContents.send('chat:importProgress', {
        stage: 'detecting',
        progress: 5,
        message: '', // Frontend translates based on stage
      })

      // 使用流式导入（在 Worker 线程中执行）
      const result = await worker.streamImport(filePath, (progress: ParseProgress) => {
        // 转发进度到渲染进程
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
        console.log('[IpcMain] Stream import successful, sessionId:', result.sessionId)
        return { success: true, sessionId: result.sessionId, diagnostics: result.diagnostics }
      } else {
        console.error('[IpcMain] Stream import failed:', result.error)
        win.webContents.send('chat:importProgress', {
          stage: 'error',
          progress: 0,
          message: result.error,
        })

        // 如果是格式不识别错误，提供诊断信息
        if (result.error === 'error.unrecognized_format') {
          const diagnosis = diagnoseFormat(filePath)
          return {
            success: false,
            error: result.error,
            diagnosis: {
              suggestion: diagnosis.suggestion,
              partialMatches: diagnosis.partialMatches.map((m) => ({
                formatName: m.formatName,
                missingFields: m.missingFields,
              })),
            },
            diagnostics: result.diagnostics,
          }
        }

        return { success: false, error: result.error, diagnostics: result.diagnostics }
      }
    } catch (error) {
      console.error('[IpcMain] Import failed:', error)

      win.webContents.send('chat:importProgress', {
        stage: 'error',
        progress: 0,
        message: String(error),
      })

      return { success: false, error: String(error) }
    }
  })

  /**
   * 检测文件格式（轻量级，仅返回格式 ID、名称和是否多聊天）
   */
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

  /**
   * 扫描多聊天文件中的聊天列表（通用）
   * 自动检测格式并调用对应格式的 scanChats
   */
  ipcMain.handle('chat:scanMultiChatFile', async (_, filePath: string) => {
    try {
      const chats = await scanMultiChatFile(filePath)
      return { success: true, chats }
    } catch (error) {
      console.error('[IpcMain] Failed to scan multi-chat files:', error)
      return { success: false, error: String(error), chats: [] }
    }
  })

  /**
   * 导入聊天记录（带格式选项）
   * 用于多聊天格式等需要额外参数的场景（如指定 chatIndex）
   */
  ipcMain.handle('chat:importWithOptions', async (_, filePath: string, formatOptions: Record<string, unknown>) => {
    try {
      win.webContents.send('chat:importProgress', {
        stage: 'detecting',
        progress: 5,
        message: '',
      })

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
        console.log('[IpcMain] Stream import (with options) successful, sessionId:', result.sessionId)
        return { success: true, sessionId: result.sessionId, diagnostics: result.diagnostics }
      } else {
        console.error('[IpcMain] Stream import (with options) failed:', result.error)
        win.webContents.send('chat:importProgress', {
          stage: 'error',
          progress: 0,
          message: result.error,
        })
        return { success: false, error: result.error, diagnostics: result.diagnostics }
      }
    } catch (error) {
      console.error('[IpcMain] Import with options failed:', error)
      win.webContents.send('chat:importProgress', {
        stage: 'error',
        progress: 0,
        message: String(error),
      })
      return { success: false, error: String(error) }
    }
  })

  /**
   * 获取所有分析会话列表
   */
  ipcMain.handle('chat:getSessions', async () => {
    try {
      const sessions = await worker.getAllSessions()

      // 填充 AI 对话计数（AI 数据库在主进程管理）
      try {
        const aiCounts = getConversationCountsBySession()
        for (const session of sessions) {
          session.aiConversationCount = aiCounts.get(session.id) || 0
        }
      } catch {
        // AI 数据库未初始化时忽略
      }

      return sessions
    } catch (error) {
      console.error('[IpcMain] Error getting sessions:', error)
      return []
    }
  })

  /**
   * 获取单个会话信息
   */
  ipcMain.handle('chat:getSession', async (_, sessionId: string) => {
    try {
      return await worker.getSession(sessionId)
    } catch (error) {
      console.error('Failed to get session info:', error)
      return null
    }
  })

  /**
   * 删除会话
   */
  ipcMain.handle('chat:deleteSession', async (_, sessionId: string) => {
    try {
      await worker.closeDatabase(sessionId)
      const result = databaseCore.deleteSession(sessionId)
      return result
    } catch (error) {
      console.error('Failed to delete session:', error)
      return false
    }
  })

  /**
   * 重命名会话
   */
  ipcMain.handle('chat:renameSession', async (_, sessionId: string, newName: string) => {
    try {
      // 先关闭 Worker 中的数据库连接（确保没有其他进程占用）
      await worker.closeDatabase(sessionId)
      // 执行重命名
      return databaseCore.renameSession(sessionId, newName)
    } catch (error) {
      console.error('Failed to rename session:', error)
      return false
    }
  })

  /**
   * 获取可用年份列表
   */
  ipcMain.handle('chat:getAvailableYears', async (_, sessionId: string) => {
    try {
      return await worker.getAvailableYears(sessionId)
    } catch (error) {
      console.error('Failed to get available years:', error)
      return []
    }
  })

  /**
   * 获取成员活跃度排行
   */
  ipcMain.handle(
    'chat:getMemberActivity',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getMemberActivity(sessionId, filter)
      } catch (error) {
        console.error('Failed to get member activity:', error)
        return []
      }
    }
  )

  /**
   * 获取成员历史昵称
   */
  ipcMain.handle('chat:getMemberNameHistory', async (_, sessionId: string, memberId: number) => {
    try {
      return await worker.getMemberNameHistory(sessionId, memberId)
    } catch (error) {
      console.error('Failed to get member name history:', error)
      return []
    }
  })

  /**
   * 获取每小时活跃度分布
   */
  ipcMain.handle(
    'chat:getHourlyActivity',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getHourlyActivity(sessionId, filter)
      } catch (error) {
        console.error('Failed to get hourly activity:', error)
        return []
      }
    }
  )

  /**
   * 获取每日活跃度趋势
   */
  ipcMain.handle(
    'chat:getDailyActivity',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getDailyActivity(sessionId, filter)
      } catch (error) {
        console.error('Failed to get daily activity:', error)
        return []
      }
    }
  )

  /**
   * 获取星期活跃度分布
   */
  ipcMain.handle(
    'chat:getWeekdayActivity',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getWeekdayActivity(sessionId, filter)
      } catch (error) {
        console.error('Failed to get weekday activity:', error)
        return []
      }
    }
  )

  /**
   * 获取月份活跃度分布
   */
  ipcMain.handle(
    'chat:getMonthlyActivity',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getMonthlyActivity(sessionId, filter)
      } catch (error) {
        console.error('Failed to get monthly activity:', error)
        return []
      }
    }
  )

  /**
   * 获取年份活跃度分布
   */
  ipcMain.handle(
    'chat:getYearlyActivity',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getYearlyActivity(sessionId, filter)
      } catch (error) {
        console.error('Failed to get yearly activity:', error)
        return []
      }
    }
  )

  /**
   * 获取消息长度分布
   */
  ipcMain.handle(
    'chat:getMessageLengthDistribution',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getMessageLengthDistribution(sessionId, filter)
      } catch (error) {
        console.error('Failed to get message length distribution:', error)
        return []
      }
    }
  )

  /**
   * 获取消息类型分布
   */
  ipcMain.handle(
    'chat:getMessageTypeDistribution',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getMessageTypeDistribution(sessionId, filter)
      } catch (error) {
        console.error('Failed to get message type distribution:', error)
        return []
      }
    }
  )

  /**
   * 获取时间范围
   */
  ipcMain.handle('chat:getTimeRange', async (_, sessionId: string) => {
    try {
      return await worker.getTimeRange(sessionId)
    } catch (error) {
      console.error('Failed to get time range:', error)
      return null
    }
  })

  /**
   * 获取数据库存储目录
   */
  ipcMain.handle('chat:getDbDirectory', async () => {
    try {
      return worker.getDbDirectory()
    } catch (error) {
      console.error('Failed to get database directory:', error)
      return null
    }
  })

  /**
   * 获取支持的格式列表
   */
  ipcMain.handle('chat:getSupportedFormats', async () => {
    return parser.getSupportedFormats()
  })

  /**
   * 获取口头禅分析数据
   */
  ipcMain.handle(
    'chat:getCatchphraseAnalysis',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getCatchphraseAnalysis(sessionId, filter)
      } catch (error) {
        console.error('Failed to get catchphrase analysis:', error)
        return { members: [] }
      }
    }
  )

  /**
   * 获取 @ 互动分析数据
   */
  ipcMain.handle(
    'chat:getMentionAnalysis',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getMentionAnalysis(sessionId, filter)
      } catch (error) {
        console.error('Failed to get @mention analysis:', error)
        return { topMentioners: [], topMentioned: [], oneWay: [], twoWay: [], totalMentions: 0, memberDetails: [] }
      }
    }
  )

  /**
   * 获取 @ 互动关系图数据
   */
  ipcMain.handle(
    'chat:getMentionGraph',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getMentionGraph(sessionId, filter)
      } catch (error) {
        console.error('Failed to get @mention graph:', error)
        return { nodes: [], links: [], maxLinkValue: 0 }
      }
    }
  )

  /**
   * 获取小团体关系图数据（基于时间相邻共现）
   */
  ipcMain.handle(
    'chat:getClusterGraph',
    async (
      _,
      sessionId: string,
      filter?: { startTs?: number; endTs?: number },
      options?: {
        lookAhead?: number
        decaySeconds?: number
        minScore?: number
        topEdges?: number
      }
    ) => {
      try {
        return await worker.getClusterGraph(sessionId, filter, options)
      } catch (error) {
        console.error('Failed to get clique graph:', error)
        return {
          nodes: [],
          links: [],
          maxLinkValue: 0,
          communities: [],
          stats: {
            totalMembers: 0,
            totalMessages: 0,
            involvedMembers: 0,
            edgeCount: 0,
            communityCount: 0,
          },
        }
      }
    }
  )

  /**
   * 获取含笑量分析数据
   */
  ipcMain.handle(
    'chat:getLaughAnalysis',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }, keywords?: string[]) => {
      try {
        return await worker.getLaughAnalysis(sessionId, filter, keywords)
      } catch (error) {
        console.error('Failed to get humor analysis:', error)
        return {
          rankByRate: [],
          rankByCount: [],
          typeDistribution: [],
          totalLaughs: 0,
          totalMessages: 0,
          groupLaughRate: 0,
        }
      }
    }
  )

  // ==================== 成员管理 ====================

  /**
   * 获取所有成员列表（含消息数和别名）
   */
  ipcMain.handle('chat:getMembers', async (_, sessionId: string) => {
    try {
      return await worker.getMembers(sessionId)
    } catch (error) {
      console.error('Failed to get member list:', error)
      return []
    }
  })

  /**
   * 获取成员列表（分页版本）
   */
  ipcMain.handle(
    'chat:getMembersPaginated',
    async (
      _,
      sessionId: string,
      params: { page: number; pageSize: number; search?: string; sortOrder?: 'asc' | 'desc' }
    ) => {
      try {
        return await worker.getMembersPaginated(sessionId, params)
      } catch (error) {
        console.error('Failed to get member list (paginated):', error)
        return { members: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }
      }
    }
  )

  /**
   * 更新成员别名
   */
  ipcMain.handle('chat:updateMemberAliases', async (_, sessionId: string, memberId: number, aliases: string[]) => {
    try {
      return await worker.updateMemberAliases(sessionId, memberId, aliases)
    } catch (error) {
      console.error('Failed to update member alias:', error)
      return false
    }
  })

  /**
   * 删除成员及其所有消息
   */
  ipcMain.handle('chat:deleteMember', async (_, sessionId: string, memberId: number) => {
    try {
      // 先关闭数据库连接
      await worker.closeDatabase(sessionId)
      // 执行删除
      return await worker.deleteMember(sessionId, memberId)
    } catch (error) {
      console.error('Failed to delete member:', error)
      return false
    }
  })

  /**
   * 更新会话的所有者（ownerId）
   */
  ipcMain.handle('chat:updateSessionOwnerId', async (_, sessionId: string, ownerId: string | null) => {
    try {
      // 先关闭数据库连接
      await worker.closeDatabase(sessionId)
      // 执行更新
      return databaseCore.updateSessionOwnerId(sessionId, ownerId)
    } catch (error) {
      console.error('Failed to update session owner:', error)
      return false
    }
  })

  // ==================== 插件系统 ====================

  /**
   * 插件参数化只读 SQL 查询
   */
  ipcMain.handle('chat:pluginQuery', async (_, sessionId: string, sql: string, params: any[]) => {
    try {
      return await worker.pluginQuery(sessionId, sql, params)
    } catch (error) {
      console.error('[IpcMain] Plugin query failed:', error)
      throw error
    }
  })

  /**
   * 插件计算卸载（纯函数在 Worker 中执行）
   */
  ipcMain.handle('chat:pluginCompute', async (_, fnString: string, input: any) => {
    try {
      return await worker.pluginCompute(fnString, input)
    } catch (error) {
      console.error('[IpcMain] Plugin compute failed:', error)
      throw error
    }
  })

  // ==================== SQL 实验室 ====================

  /**
   * 执行用户 SQL 查询
   */
  ipcMain.handle('chat:executeSQL', async (_, sessionId: string, sql: string) => {
    try {
      return await worker.executeRawSQL(sessionId, sql)
    } catch (error) {
      console.error('Failed to execute SQL:', error)
      throw error
    }
  })

  /**
   * 获取数据库 Schema
   */
  ipcMain.handle('chat:getSchema', async (_, sessionId: string) => {
    try {
      return await worker.getSchema(sessionId)
    } catch (error) {
      console.error('Failed to get schema:', error)
      return []
    }
  })

  // ==================== 会话索引 ====================

  /**
   * 生成会话索引
   */
  ipcMain.handle('session:generate', async (_, sessionId: string, gapThreshold?: number) => {
    try {
      return await worker.generateSessions(sessionId, gapThreshold)
    } catch (error) {
      console.error('Failed to generate session index:', error)
      throw error
    }
  })

  /**
   * 检查是否已生成会话索引
   */
  ipcMain.handle('session:hasIndex', async (_, sessionId: string) => {
    try {
      return await worker.hasSessionIndex(sessionId)
    } catch (error) {
      console.error('Failed to check session index:', error)
      return false
    }
  })

  /**
   * 获取会话索引统计信息
   */
  ipcMain.handle('session:getStats', async (_, sessionId: string) => {
    try {
      return await worker.getSessionStats(sessionId)
    } catch (error) {
      console.error('Failed to get session stats:', error)
      return { sessionCount: 0, hasIndex: false, gapThreshold: 1800 }
    }
  })

  /**
   * 清空会话索引
   */
  ipcMain.handle('session:clear', async (_, sessionId: string) => {
    try {
      await worker.clearSessions(sessionId)
      return true
    } catch (error) {
      console.error('Failed to clear session index:', error)
      return false
    }
  })

  /**
   * 更新会话切分阈值
   */
  ipcMain.handle('session:updateGapThreshold', async (_, sessionId: string, gapThreshold: number | null) => {
    try {
      await worker.updateSessionGapThreshold(sessionId, gapThreshold)
      return true
    } catch (error) {
      console.error('Failed to update threshold:', error)
      return false
    }
  })

  /**
   * 获取会话列表（用于时间线导航）
   */
  ipcMain.handle('session:getSessions', async (_, sessionId: string) => {
    try {
      return await worker.getSessions(sessionId)
    } catch (error) {
      console.error('Failed to get session list:', error)
      return []
    }
  })

  // ==================== 会话摘要 ====================

  /**
   * 生成单个会话摘要
   */
  ipcMain.handle(
    'session:generateSummary',
    async (_, dbSessionId: string, chatSessionId: number, locale?: string, forceRegenerate?: boolean) => {
      console.log('[IPC] session:generateSummary request received:', {
        dbSessionId,
        chatSessionId,
        locale,
        forceRegenerate,
      })
      try {
        const { generateSessionSummary } = await import('../ai/summary')
        const result = await generateSessionSummary(
          dbSessionId,
          chatSessionId,
          locale || 'zh-CN',
          forceRegenerate || false
        )
        console.log('[IPC] session:generateSummary result:', result)
        return result
      } catch (error) {
        console.error('[IPC] Failed to generate session summary:', error)
        return { success: false, error: String(error) }
      }
    }
  )

  /**
   * 批量生成会话摘要
   */
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

  /**
   * 批量检查会话是否可以生成摘要
   */
  ipcMain.handle('session:checkCanGenerateSummary', async (_, dbSessionId: string, chatSessionIds: number[]) => {
    try {
      const { checkSessionsCanGenerateSummary } = await import('../ai/summary')
      const results = checkSessionsCanGenerateSummary(dbSessionId, chatSessionIds)
      // 将 Map 转换为普通对象以便 IPC 传输
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

  /**
   * 根据时间范围查询会话列表
   */
  ipcMain.handle('session:getByTimeRange', async (_, dbSessionId: string, startTs: number, endTs: number) => {
    console.log('[session:getByTimeRange] Query params:', { dbSessionId, startTs, endTs })
    console.log('[session:getByTimeRange] Time range:', {
      start: new Date(startTs * 1000).toISOString(),
      end: new Date(endTs * 1000).toISOString(),
    })

    try {
      const db = databaseCore.openDatabase(dbSessionId, true)
      if (!db) {
        console.log('[session:getByTimeRange] Failed to open database')
        return []
      }

      // 先查询总数和时间范围
      const stats = db
        .prepare('SELECT COUNT(*) as count, MIN(start_ts) as minTs, MAX(start_ts) as maxTs FROM chat_session')
        .get() as { count: number; minTs: number; maxTs: number }
      console.log('[session:getByTimeRange] Database session stats:', {
        count: stats.count,
        minTs: stats.minTs ? new Date(stats.minTs * 1000).toISOString() : null,
        maxTs: stats.maxTs ? new Date(stats.maxTs * 1000).toISOString() : null,
      })

      const sessions = db
        .prepare(
          `
            SELECT
              id,
              start_ts as startTs,
              end_ts as endTs,
              message_count as messageCount,
              summary
            FROM chat_session
            WHERE start_ts >= ? AND start_ts <= ?
            ORDER BY start_ts DESC
          `
        )
        .all(startTs, endTs) as Array<{
        id: number
        startTs: number
        endTs: number
        messageCount: number
        summary: string | null
      }>

      console.log('[session:getByTimeRange] Query result count:', sessions.length)
      return sessions
    } catch (error) {
      console.error('Failed to query sessions by time range:', error)
      return []
    }
  })

  /**
   * 获取最近 N 条会话
   */
  ipcMain.handle('session:getRecent', async (_, dbSessionId: string, limit: number) => {
    console.log('[session:getRecent] Query params:', { dbSessionId, limit })
    try {
      const db = databaseCore.openDatabase(dbSessionId, true)
      if (!db) {
        console.log('[session:getRecent] Failed to open database')
        return []
      }

      // 先检查表是否存在
      const tableInfo = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chat_session'").get()
      console.log('[session:getRecent] chat_session table:', tableInfo ? 'exists' : 'not exists')

      if (!tableInfo) {
        return []
      }

      const sessions = db
        .prepare(
          `
          SELECT
            id,
            start_ts as startTs,
            end_ts as endTs,
            message_count as messageCount,
            summary
          FROM chat_session
          ORDER BY start_ts DESC
          LIMIT ?
        `
        )
        .all(limit) as Array<{
        id: number
        startTs: number
        endTs: number
        messageCount: number
        summary: string | null
      }>

      console.log('[session:getRecent] Query result count:', sessions.length)
      return sessions
    } catch (error) {
      console.error('Failed to query recent sessions:', error)
      return []
    }
  })

  // ==================== 增量导入 ====================

  /**
   * 分析增量导入（检测去重后能新增多少消息）
   */
  ipcMain.handle('chat:analyzeIncrementalImport', async (_, sessionId: string, filePath: string) => {
    try {
      // 检测文件格式
      const formatFeature = detectFormat(filePath)
      if (!formatFeature) {
        const diagnosis = diagnoseFormat(filePath)
        return {
          error: 'error.unrecognized_format',
          diagnosis: {
            suggestion: diagnosis.suggestion,
          },
        }
      }

      // 使用 Worker 分析
      const result = await worker.analyzeIncrementalImport(sessionId, filePath)
      return result
    } catch (error) {
      console.error('[IpcMain] Failed to analyze incremental import:', error)
      return { error: String(error) }
    }
  })

  /**
   * 执行增量导入
   */
  ipcMain.handle('chat:incrementalImport', async (_, sessionId: string, filePath: string) => {
    try {
      // 发送进度
      win.webContents.send('chat:importProgress', {
        stage: 'saving',
        progress: 0,
        message: '',
      })

      const result = await worker.incrementalImport(sessionId, filePath, (progress) => {
        win.webContents.send('chat:importProgress', {
          stage: progress.stage,
          progress: progress.percentage,
          message: progress.message,
        })
      })

      if (result.success) {
        // 增量生成会话索引（仅处理新增消息，保留已有会话和摘要）
        try {
          await worker.generateIncrementalSessions(sessionId)
        } catch (e) {
          console.error('[IpcMain] Failed to incrementally generate session index:', e)
        }
      }

      return result
    } catch (error) {
      console.error('[IpcMain] Failed to execute incremental import:', error)
      return { success: false, error: String(error) }
    }
  })

  // ==================== 批量管理：导出会话为临时文件 ====================

  /**
   * 导出多个会话为临时文件（用于合并）
   */
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

  /**
   * 清理临时导出文件
   */
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
