/**
 * ChatLab Server — Sync module entry point
 *
 * Wires @openchatlab/sync with server-side implementations.
 */

import type { FastifyInstance } from 'fastify'
import type { DatabaseManager } from '@openchatlab/node-runtime'
import { PreferencesManager, createDatabaseManagerAdapter, ownerProfileService } from '@openchatlab/node-runtime'
import type { PathProvider } from '@openchatlab/core'
import { DataSourceManager, PullEngine, initScheduler, stopAllTimers } from '@openchatlab/sync'
import type { SyncLogger } from '@openchatlab/sync'
import { NodeFetcher, DirectImporter, NoopNotifier } from './adapters'
import { registerAutomationRoutes } from './routes'

export interface SyncRouteContext {
  dsManager: DataSourceManager
  pullEngine: PullEngine
  dbManager: DatabaseManager
  serverInfo: { port: number; host: string; token: string }
}

const syncLogger: SyncLogger = {
  info: (msg) => console.log(`[Sync] ${msg}`),
  warn: (msg) => console.warn(`[Sync] ${msg}`),
  error: (msg, err?) => console.error(`[Sync] ${msg}`, err ?? ''),
}

let dsManager: DataSourceManager | null = null
let pullEngine: PullEngine | null = null

export function initSync(
  server: FastifyInstance,
  dbManager: DatabaseManager,
  pathProvider: PathProvider,
  serverInfo: { port: number; host: string; token: string }
): void {
  const settingsDir = pathProvider.getSettingsDir()

  dsManager = new DataSourceManager(settingsDir, syncLogger)

  const fetcher = new NodeFetcher()
  const importer = new DirectImporter(dbManager, syncLogger)
  const notifier = new NoopNotifier()

  const sessionAdapter = createDatabaseManagerAdapter(dbManager)
  const preferences = new PreferencesManager(pathProvider.getSystemDir())

  pullEngine = new PullEngine({
    fetcher,
    importer,
    notifier,
    dsManager,
    logger: syncLogger,
    onSessionImported: (localSessionId) => {
      const result = ownerProfileService.tryApplyOwnerProfile(sessionAdapter, preferences, localSessionId)
      if (result.applied) {
        syncLogger.info(`[Pull] Applied owner profile to session ${localSessionId} (owner: ${result.ownerId})`)
      }
    },
  })

  registerAutomationRoutes(server, { dsManager, pullEngine, dbManager, serverInfo })

  initScheduler({
    dsManager,
    pullEngine,
    logger: syncLogger,
  })
}

export function cleanupSync(): void {
  stopAllTimers()
  dsManager = null
  pullEngine = null
}
