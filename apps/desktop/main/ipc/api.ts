/**
 * ChatLab API — IPC handlers for renderer process (hierarchical data source model)
 *
 * Migrated to @openchatlab/sync shared package.
 */

import { ipcMain } from 'electron'
import type { IpcContext } from './types'
import * as apiServer from '../api'
import { setConfigManager } from '../api'
import { getSettingsDir, getSystemDataDir } from '../paths/locations'
import { apiLogger } from '../api/logger'
import { getImportingStatus } from '../api/routes/import'
import { getInternalDbManager } from '../internal-api/server'
import { PreferencesManager, createDatabaseManagerAdapter, ownerProfileService } from '@openchatlab/node-runtime'
import { ElectronFetcher, WorkerImporter, BrowserWindowNotifier } from '../api/adapters'
import { ConfigManager, DataSourceManager, PullEngine, initScheduler, stopAllTimers } from '@openchatlab/sync'

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

export function getDataSourceManager(): DataSourceManager {
  ensureInstances()
  return dsManager
}

export function getPullEngine(): PullEngine {
  ensureInstances()
  return pullEngine
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

  // Data-source sync routes have moved to the shared internal HTTP server.
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
