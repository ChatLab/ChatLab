/**
 * Demo 示例数据下载与导入 IPC 处理器
 */

import { ipcMain } from 'electron'
import { importDemoSessions, type DemoImportProgress } from '@openchatlab/node-runtime'
import * as worker from '../worker/workerManager'
import type { IpcContext } from './types'

export function registerDemoHandlers(ctx: IpcContext): void {
  const { win } = ctx

  /**
   * 下载并导入 Demo 示例数据
   * 返回群聊和私聊的 sessionId
   */
  ipcMain.handle(
    'demo:downloadAndImport',
    async (
      _,
      locale: string
    ): Promise<{
      success: boolean
      groupSessionId?: string
      privateSessionIds?: string[]
      error?: string
    }> => {
      const sendProgress = (progress: DemoImportProgress) => {
        win.webContents.send('demo:progress', progress)
      }

      return importDemoSessions({
        locale: locale === 'cn' ? 'cn' : 'en',
        tempPrefix: 'desktop-demo-',
        importFile: (filePath) => worker.streamImport(filePath),
        deleteSession: (sessionId) => worker.deleteImportedSession(sessionId),
        onProgress: sendProgress,
      })
    }
  )
}
