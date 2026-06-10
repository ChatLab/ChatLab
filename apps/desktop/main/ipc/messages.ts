/**
 * 消息导出 IPC 处理器
 */

import { ipcMain } from 'electron'
import type { IpcContext } from './types'
import * as worker from '../worker/workerManager'

export function registerMessagesHandlers(_ctx: IpcContext): void {
  ipcMain.handle(
    'ai:exportFilterResultToFile',
    async (
      _,
      params: {
        sessionId: string
        sessionName: string
        outputDir: string
        format?: 'txt' | 'json' | 'markdown'
        timeFilter?: { startTs: number; endTs: number }
      }
    ) => {
      try {
        return await worker.exportFilterResultToFile(params)
      } catch (error) {
        console.error('Failed to export filtered results:', error)
        return { success: false, error: String(error) }
      }
    }
  )
}
