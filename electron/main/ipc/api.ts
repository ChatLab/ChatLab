/**
 * ChatLab API 服务 IPC 处理器
 */

import { ipcMain } from 'electron'
import type { IpcContext } from './types'
import * as apiServer from '../api'
import { loadConfig, regenerateToken, updateConfig } from '../api/config'

export function registerApiHandlers(_ctx: IpcContext): void {
  ipcMain.handle('api:getConfig', () => {
    const config = loadConfig()
    return {
      enabled: config.enabled,
      port: config.port,
      token: config.token,
      createdAt: config.createdAt,
    }
  })

  ipcMain.handle('api:getStatus', () => {
    return apiServer.getStatus()
  })

  ipcMain.handle('api:setEnabled', async (_event, enabled: boolean) => {
    return apiServer.setEnabled(enabled)
  })

  ipcMain.handle('api:setPort', async (_event, port: number) => {
    return apiServer.setPort(port)
  })

  ipcMain.handle('api:regenerateToken', () => {
    return regenerateToken()
  })

  ipcMain.handle('api:updateConfig', (_event, partial: Record<string, unknown>) => {
    return updateConfig(partial as any)
  })
}

/**
 * 应用启动后尝试自动启动 API 服务，如果失败则通知主窗口
 */
export async function initApiServer(ctx: IpcContext): Promise<void> {
  await apiServer.autoStart()

  const status = apiServer.getStatus()
  if (status.error) {
    ctx.win.webContents.once('did-finish-load', () => {
      ctx.win.webContents.send('api:startupError', {
        error: status.error,
      })
    })
  }
}

export async function cleanupApiServer(): Promise<void> {
  await apiServer.stop()
}
