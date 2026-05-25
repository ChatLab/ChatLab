/**
 * ChatLab Internal Web API — /_web/ routes
 *
 * 供 CLI serve Web 前端使用的内部 API（无认证、UI 友好的响应格式）。
 * 数据格式直接对齐 QueryAdapter 接口，避免前端二次转换。
 *
 * Route modules:
 *   sessions  – Session CRUD
 *   members   – Member management
 *   analytics – Stats and advanced analytics
 *   sql       – SQL Lab and plugin query
 *   sessionIndex – Session index generation + FTS
 *   summaries – LLM summary generation
 *   import    – File / directory / incremental import + demo
 *   merge     – Merge parse / conflicts / execute
 *   export    – Markdown export
 *   cache     – Storage management + save to downloads + show in folder
 */

import * as os from 'os'
import * as path from 'path'
import type { FastifyInstance } from 'fastify'
import type { PathProvider } from '@openchatlab/core'
import type { DatabaseManager } from '@openchatlab/node-runtime'
import { createDatabaseManagerAdapter } from '@openchatlab/node-runtime'
import { MergeSessionCache } from '../../../merger/merge-cache'
import { registerSessionRoutes } from './sessions'
import { registerMemberRoutes } from './members'
import { registerAnalyticsRoutes } from './analytics'
import { registerSqlRoutes } from './sql'
import { registerSessionIndexRoutes } from './session-index'
import { registerSummaryRoutes } from './summaries'
import { registerImportRoutes } from './import'
import { registerMergeRoutes } from './merge'
import { registerExportRoutes } from './export'
import { registerCacheRoutes } from './cache'

export function registerWebRoutes(
  server: FastifyInstance,
  dbManager: DatabaseManager,
  options?: { pathProvider?: PathProvider; nativeBinding?: string }
): void {
  const adapter = createDatabaseManagerAdapter(dbManager)

  const mergeCache = options?.pathProvider
    ? new MergeSessionCache(options.pathProvider, { nativeBinding: options.nativeBinding })
    : null
  mergeCache?.cleanupOrphans()

  const fallbackPathProvider: PathProvider = {
    getSystemDir: () => path.join(os.homedir(), '.chatlab'),
    getUserDataDir: () => path.join(os.homedir(), '.chatlab', 'data'),
    getDatabaseDir: () => path.join(os.homedir(), '.chatlab', 'data', 'databases'),
    getAiDataDir: () => path.join(os.homedir(), '.chatlab', 'ai'),
    getSettingsDir: () => path.join(os.homedir(), '.chatlab', 'settings'),
    getCacheDir: () => path.join(os.homedir(), '.chatlab', 'cache'),
    getTempDir: () => path.join(os.homedir(), '.chatlab', 'temp'),
    getLogsDir: () => path.join(os.homedir(), '.chatlab', 'logs'),
    getDownloadsDir: () => path.join(os.homedir(), 'Downloads'),
  }
  const resolvedPathProvider = options?.pathProvider ?? fallbackPathProvider

  registerSessionRoutes(server, adapter)
  registerMemberRoutes(server, adapter)
  registerAnalyticsRoutes(server, dbManager, adapter)
  registerSqlRoutes(server, adapter)
  registerSessionIndexRoutes(server, adapter)
  registerSummaryRoutes(server, dbManager, adapter)
  registerImportRoutes(server, dbManager)
  if (mergeCache) {
    registerMergeRoutes(server, dbManager, mergeCache)
  }
  registerExportRoutes(server, adapter)
  registerCacheRoutes(server, resolvedPathProvider)
}
