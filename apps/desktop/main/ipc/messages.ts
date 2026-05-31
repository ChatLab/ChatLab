/**
 * 消息查询/导出 IPC 处理器
 *
 * 大部分消息查询已迁移到 Internal HTTP Server (FetchMessageAdapter)。
 * 保留 filterMessagesWithContext / getMultipleSessionsMessages（ElectronAIAdapter 依赖）
 * 和导出功能（需要文件系统写入 + 进度推送）。
 */

import { ipcMain } from 'electron'
import type { IpcContext } from './types'
import * as worker from '../worker/workerManager'

export function registerMessagesHandlers({ win }: IpcContext): void {
  // ElectronAIAdapter 依赖的消息筛选/多会话查询
  ipcMain.handle(
    'ai:filterMessagesWithContext',
    async (
      _,
      sessionId: string,
      keywords?: string[],
      timeFilter?: { startTs: number; endTs: number },
      senderIds?: number[],
      contextSize?: number,
      page?: number,
      pageSize?: number
    ) => {
      try {
        return await worker.filterMessagesWithContext(
          sessionId,
          keywords,
          timeFilter,
          senderIds,
          contextSize,
          page,
          pageSize
        )
      } catch (error) {
        console.error('Failed to filter messages:', error)
        return {
          blocks: [],
          stats: { totalMessages: 0, hitMessages: 0, totalChars: 0 },
          pagination: { page: 1, pageSize: 50, totalBlocks: 0, totalHits: 0, hasMore: false },
        }
      }
    }
  )

  ipcMain.handle(
    'ai:getMultipleSessionsMessages',
    async (_, sessionId: string, chatSessionIds: number[], page?: number, pageSize?: number) => {
      try {
        return await worker.getMultipleSessionsMessages(sessionId, chatSessionIds, page, pageSize)
      } catch (error) {
        console.error('Failed to get multiple sessions messages:', error)
        return {
          blocks: [],
          stats: { totalMessages: 0, hitMessages: 0, totalChars: 0 },
          pagination: { page: 1, pageSize: 50, totalBlocks: 0, totalHits: 0, hasMore: false },
        }
      }
    }
  )

  // 导出（需要文件系统写入 + 进度推送）
  ipcMain.handle(
    'ai:exportFilterResultToFile',
    async (
      _,
      params: {
        sessionId: string
        sessionName: string
        outputDir: string
        filterMode: 'condition' | 'session'
        keywords?: string[]
        timeFilter?: { startTs: number; endTs: number }
        senderIds?: number[]
        contextSize?: number
        chatSessionIds?: number[]
      }
    ) => {
      try {
        return await worker.exportFilterResultToFile(params, (progress) => {
          win.webContents.send('ai:exportProgress', progress)
        })
      } catch (error) {
        console.error('Failed to export filtered results:', error)
        return { success: false, error: String(error) }
      }
    }
  )
}
