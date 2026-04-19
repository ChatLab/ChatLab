/**
 * ChatLab API — IPC handlers for renderer process (hierarchical data source model)
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
  addImportSessions,
  removeImportSession,
  type DataSource,
} from '../api/dataSource'
import { initScheduler, stopAllTimers, stopTimer, reloadTimer, triggerPull, triggerPullAll } from '../api/pullScheduler'
import { fetchRemoteSessions } from '../api/pullDiscovery'

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
    (_event, partial: { name?: string; baseUrl: string; token: string; intervalMinutes: number }) => {
      const ds = addDataSource(partial)
      return ds
    }
  )

  ipcMain.handle(
    'api:updateDataSource',
    (_event, id: string, updates: Partial<Pick<DataSource, 'name' | 'baseUrl' | 'token' | 'intervalMinutes' | 'enabled'>>) => {
      const ds = updateDataSource(id, updates)
      if (ds) {
        reloadTimer(ds.id)
      }
      return ds
    }
  )

  ipcMain.handle('api:deleteDataSource', (_event, id: string) => {
    stopTimer(id)
    return deleteDataSource(id)
  })

  // ==================== Import Session Management ====================

  ipcMain.handle(
    'api:addImportSessions',
    (_event, sourceId: string, sessions: Array<{ name: string; remoteSessionId: string }>) => {
      const added = addImportSessions(sourceId, sessions)
      reloadTimer(sourceId)
      return added
    }
  )

  ipcMain.handle('api:removeImportSession', (_event, sourceId: string, sessionId: string) => {
    const result = removeImportSession(sourceId, sessionId)
    reloadTimer(sourceId)
    return result
  })

  // ==================== Sync ====================

  ipcMain.handle('api:triggerPull', async (_event, sourceId: string, sessionId?: string) => {
    return triggerPull(sourceId, sessionId)
  })

  ipcMain.handle('api:triggerPullAll', async (_event, sourceId: string) => {
    return triggerPullAll(sourceId)
  })

  // ==================== Remote Discovery ====================

  ipcMain.handle('api:fetchRemoteSessions', async (_event, baseUrl: string, token: string) => {
    try {
      return await fetchRemoteSessions(baseUrl, token || undefined)
    } catch (err: any) {
      throw new Error(err.message || 'Failed to fetch remote sessions')
    }
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

  initScheduler()
}

export async function cleanupApiServer(): Promise<void> {
  stopAllTimers()
  await apiServer.stop()
}
