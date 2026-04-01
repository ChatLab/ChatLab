/**
 * ChatLab API — IPC handlers for renderer process
 */

import { ipcMain } from 'electron'
import type { IpcContext } from './types'
import * as apiServer from '../api'
import { loadConfig, regenerateToken, updateConfig } from '../api/config'
import {
  loadDataSources,
  addDataSource,
  updateDataSource,
  deleteDataSource,
  type DataSource,
} from '../api/dataSource'
import {
  initScheduler,
  stopAllTimers,
  reloadTimer,
  triggerPull,
} from '../api/pullScheduler'

export function registerApiHandlers(_ctx: IpcContext): void {
  // ==================== API Server Management ====================

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

  // ==================== Data Source Management ====================

  ipcMain.handle('api:getDataSources', () => {
    return loadDataSources()
  })

  ipcMain.handle(
    'api:addDataSource',
    (
      _event,
      partial: Omit<
        DataSource,
        'id' | 'createdAt' | 'lastPullAt' | 'lastStatus' | 'lastError' | 'lastNewMessages'
      >
    ) => {
      const ds = addDataSource(partial)
      if (ds.enabled) {
        reloadTimer(ds.id)
      }
      return ds
    }
  )

  ipcMain.handle('api:updateDataSource', (_event, id: string, updates: Partial<DataSource>) => {
    const ds = updateDataSource(id, updates)
    if (ds) {
      reloadTimer(ds.id)
    }
    return ds
  })

  ipcMain.handle('api:deleteDataSource', (_event, id: string) => {
    reloadTimer(id) // stops timer
    return deleteDataSource(id)
  })

  ipcMain.handle('api:triggerPull', async (_event, id: string) => {
    return triggerPull(id)
  })
}

/**
 * Auto-start API server and Pull scheduler after app launch
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

  // Initialize Pull scheduler (independent of API server, pulls even if API is not running)
  initScheduler()
}

export async function cleanupApiServer(): Promise<void> {
  stopAllTimers()
  await apiServer.stop()
}
