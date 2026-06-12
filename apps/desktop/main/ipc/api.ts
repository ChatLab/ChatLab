/**
 * ChatLab API — IPC handlers for renderer process (hierarchical data source model)
 *
 * Migrated to @openchatlab/sync shared package.
 */

import { ipcMain, net } from 'electron'
import type { IpcContext } from './types'
import * as apiServer from '../api'
import { setConfigManager } from '../api'
import { getSettingsDir, getSystemDataDir } from '../paths'
import { apiLogger } from '../api/logger'
import { getImportingStatus } from '../api/routes/import'
import { deleteSession as deleteSessionFile } from '../database/core'
import { getInternalDbManager } from '../internal-api'
import { PreferencesManager, createDatabaseManagerAdapter, ownerProfileService } from '@openchatlab/node-runtime'
import { ElectronFetcher, WorkerImporter, BrowserWindowNotifier } from '../api/adapters'
import {
  ConfigManager,
  DataSourceManager,
  PullEngine,
  initScheduler,
  stopAllTimers,
  stopTimer,
  reloadTimer,
  buildRemoteSessionsUrl,
  parseRemoteSessionsResponse,
  normalizeBaseUrl,
} from '@openchatlab/sync'
import type { DataSourceUpdatable, RemoteSessionDiscoveryQuery, RemoteSessionDiscoveryResult } from '@openchatlab/sync'

const syncLogger = {
  info: (msg: string) => apiLogger.info(msg),
  warn: (msg: string) => apiLogger.warn(msg),
  error: (msg: string, err?: unknown) => apiLogger.error(msg, err),
}

let configManager: ConfigManager
let dsManager: DataSourceManager
let pullEngine: PullEngine

function ensureInstances(): void {
  if (configManager) return

  const settingsDir = getSettingsDir()
  configManager = new ConfigManager(settingsDir, syncLogger)
  dsManager = new DataSourceManager(settingsDir, syncLogger)
  setConfigManager(configManager)

  pullEngine = new PullEngine({
    fetcher: new ElectronFetcher(),
    importer: new WorkerImporter(syncLogger),
    notifier: new BrowserWindowNotifier(),
    dsManager,
    logger: syncLogger,
    isImporting: getImportingStatus,
    onSessionImported: (localSessionId) => {
      // Resolve lazily: the internal server (and its DatabaseManager) starts after IPC registration
      const dbManager = getInternalDbManager()
      if (!dbManager) return
      const result = ownerProfileService.tryApplyOwnerProfile(
        createDatabaseManagerAdapter(dbManager),
        new PreferencesManager(getSystemDataDir()),
        localSessionId
      )
      if (result.applied) {
        syncLogger.info(`[Pull] Applied owner profile to session ${localSessionId} (owner: ${result.ownerId})`)
      }
    },
  })
}

/** Exported for use by api/index.ts */
export function getConfigManager(): ConfigManager {
  ensureInstances()
  return configManager
}

function fetchRemoteSessions(
  baseUrl: string,
  token?: string,
  query: RemoteSessionDiscoveryQuery = {}
): Promise<RemoteSessionDiscoveryResult> {
  return new Promise<RemoteSessionDiscoveryResult>((resolve, reject) => {
    const url = buildRemoteSessionsUrl(normalizeBaseUrl(baseUrl), query)

    const request = net.request(url)
    if (token) {
      request.setHeader('Authorization', `Bearer ${token}`)
    }
    request.setHeader('Accept', 'application/json')

    let body = ''

    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Remote server returned HTTP ${response.statusCode}`))
        return
      }

      response.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf-8')
      })

      response.on('end', () => {
        try {
          resolve(parseRemoteSessionsResponse(body))
        } catch {
          reject(new Error('Failed to parse remote sessions response'))
        }
      })

      response.on('error', (err: Error) => {
        reject(err)
      })
    })

    request.on('error', (err: Error) => {
      reject(err)
    })

    request.end()
  })
}

export function registerApiHandlers(_ctx: IpcContext): void {
  ensureInstances()

  // ==================== API Server Management ====================

  ipcMain.handle('api:getConfig', () => {
    const config = configManager.load()
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
    return configManager.regenerateToken()
  })

  ipcMain.handle('api:updateConfig', (_event, partial: Record<string, unknown>) => {
    return configManager.update(partial as any)
  })

  // ==================== Data Source Management ====================

  ipcMain.handle('api:getDataSources', () => {
    return dsManager.loadAll()
  })

  ipcMain.handle(
    'api:addDataSource',
    (
      _event,
      partial: { name?: string; baseUrl: string; token: string; intervalMinutes: number; pullLimit?: number }
    ) => {
      return dsManager.add(partial)
    }
  )

  ipcMain.handle('api:updateDataSource', (_event, id: string, updates: DataSourceUpdatable) => {
    const ds = dsManager.update(id, updates)
    if (ds) {
      reloadTimer(ds.id)
    }
    return ds
  })

  ipcMain.handle('api:deleteDataSource', (_event, id: string) => {
    stopTimer(id)
    return dsManager.delete(id)
  })

  // ==================== Import Session Management ====================

  ipcMain.handle(
    'api:addImportSessions',
    (_event, sourceId: string, sessions: Array<{ name: string; remoteSessionId: string }>) => {
      const added = dsManager.addSessions(sourceId, sessions)
      reloadTimer(sourceId, true)
      for (const sess of added) {
        pullEngine.triggerPull(sourceId, sess.id).catch(() => {})
      }
      return added
    }
  )

  ipcMain.handle('api:removeImportSession', (_event, sourceId: string, sessionId: string, deleteData?: boolean) => {
    const removed = dsManager.removeSession(sourceId, sessionId)
    if (!removed) return false
    reloadTimer(sourceId)
    if (deleteData && removed.targetSessionId) {
      deleteSessionFile(removed.targetSessionId)
    }
    return true
  })

  // ==================== Sync ====================

  ipcMain.handle('api:triggerPull', async (_event, sourceId: string, sessionId?: string) => {
    return pullEngine.triggerPull(sourceId, sessionId)
  })

  ipcMain.handle('api:triggerPullAll', async (_event, sourceId: string) => {
    return pullEngine.triggerPullAll(sourceId)
  })

  // ==================== Remote Discovery ====================

  ipcMain.handle(
    'api:fetchRemoteSessions',
    async (_event, baseUrl: string, token: string, query?: { keyword?: string; limit?: number; cursor?: string }) => {
      try {
        return await fetchRemoteSessions(baseUrl, token || undefined, query)
      } catch (err: any) {
        throw new Error(err.message || 'Failed to fetch remote sessions')
      }
    }
  )
}

/**
 * Auto-start API server and Pull scheduler after app launch
 */
export async function initApiServer(ctx: IpcContext): Promise<void> {
  ensureInstances()

  await apiServer.autoStart()

  const status = apiServer.getStatus()
  if (status.error) {
    ctx.win.webContents.once('did-finish-load', () => {
      ctx.win.webContents.send('api:startupError', {
        error: status.error,
      })
    })
  }

  initScheduler({
    dsManager,
    pullEngine,
    logger: syncLogger,
  })
}

export async function cleanupApiServer(): Promise<void> {
  stopAllTimers()
  await apiServer.stop()
}
