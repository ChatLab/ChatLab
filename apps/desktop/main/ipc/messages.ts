/**
 * 消息导出 IPC 处理器
 *
 * filterMessagesWithContext / getMultipleSessionsMessages 已迁移到共享 HTTP 路由。
 * 仅保留导出功能（需要文件系统写入 + 进度推送）。
 */

import { ipcMain } from 'electron'
import type { IpcContext } from './types'
import * as worker from '../worker/workerManager'

export function registerMessagesHandlers({ win }: IpcContext): void {
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
