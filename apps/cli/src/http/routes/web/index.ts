/**
 * ChatLab Internal Web API — /_web/ routes
 *
 * 供 CLI Web 前端使用的内部 API（无认证、UI 友好的响应格式）。
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
import type {
  DatabaseManager,
  AIChatManager,
  AssistantManager,
  SkillManagerCore,
  LLMConfigStore,
  CustomProviderStore,
  CustomModelStore,
  PendingDataDirMigration,
} from '@openchatlab/node-runtime'
import {
  createDatabaseManagerAdapter,
  createNodeDataDirSwitch,
  getDefaultNodeUserDataDir,
  getPendingNodeDataDirMigration,
  AnalyticsService,
  type SemanticIndexRuntime,
} from '@openchatlab/node-runtime'
import { registerSharedRoutes } from '@openchatlab/http-routes'
import type { HttpRouteContext } from '@openchatlab/http-routes'
import { MergeSessionCache } from '../../../merger/merge-cache'
import { registerImportRoutes } from './import'
import { openDirectoryPath, showPathInFolder } from './cache'
import { getVersion } from '../../../version'
import { buildWebUpdateCheckResult } from './update-check'

export interface AiContextOptions {
  aiDataDir: string
  aiChatManager: AIChatManager
  assistantManager: AssistantManager
  skillManagerCore: SkillManagerCore
  llmConfigStore: LLMConfigStore
  customProviderStore: CustomProviderStore
  customModelStore: CustomModelStore
  runAgentStream?: HttpRouteContext['runAgentStream']
}

export function registerWebRoutes(
  server: FastifyInstance,
  dbManager: DatabaseManager,
  options?: {
    pathProvider?: PathProvider
    nativeBinding?: string
    aiContext?: AiContextOptions
    /** 由 server 入口注入的共享语义索引运行时；传入时由调用方管理生命周期 */
    semanticIndexService?: SemanticIndexRuntime
  }
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
    getVectorDir: () => path.join(os.homedir(), '.chatlab', 'data', 'vector'),
    getAiDataDir: () => path.join(os.homedir(), '.chatlab', 'ai'),
    getSettingsDir: () => path.join(os.homedir(), '.chatlab', 'settings'),
    getCacheDir: () => path.join(os.homedir(), '.chatlab', 'cache'),
    getTempDir: () => path.join(os.homedir(), '.chatlab', 'temp'),
    getLogsDir: () => path.join(os.homedir(), '.chatlab', 'logs'),
    getDownloadsDir: () => path.join(os.homedir(), 'Downloads'),
  }
  const resolvedPathProvider = options?.pathProvider ?? fallbackPathProvider

  const ai = options?.aiContext

  const cliStreamImport = async (dm: typeof dbManager, filePath: string) => {
    const { streamImport } = await import('../../../import/stream-import')
    const result = await streamImport(dm, filePath)
    if (!result.sessionId) throw new Error('Import succeeded but no sessionId returned')
    return { sessionId: result.sessionId }
  }

  const defaultUserDataDir = getDefaultNodeUserDataDir()
  const isCustom = path.resolve(resolvedPathProvider.getUserDataDir()) !== path.resolve(defaultUserDataDir)

  const semanticIndexService = options?.semanticIndexService

  const analyticsService = process.env.APTABASE_APP_KEY
    ? new AnalyticsService(resolvedPathProvider.getSystemDir(), process.env.APTABASE_APP_KEY, getVersion())
    : undefined

  registerSharedRoutes(
    server,
    {
      dbManager,
      sessionAdapter: adapter,
      pathProvider: resolvedPathProvider,
      getVersion,
      nativeBinding: options?.nativeBinding,
      semanticIndexService,
      analyticsService,
      openDirectory: openDirectoryPath,
      showInFolder: showPathInFolder,
      downloadsDir: resolvedPathProvider.getDownloadsDir(),
      defaultUserDataDir,
      isCustomDataDir: isCustom,
      canSetDataDir: !process.env.CHATLAB_DATA_DIR,
      getPendingDataDirMigration: (): PendingDataDirMigration | null =>
        getPendingNodeDataDirMigration(resolvedPathProvider.getSystemDir()),
      setDataDir: (dirPath, migrate) =>
        createNodeDataDirSwitch({
          systemDir: resolvedPathProvider.getSystemDir(),
          currentDir: resolvedPathProvider.getUserDataDir(),
          targetDir: dirPath,
          defaultDir: defaultUserDataDir,
          migrate,
          envDataDir: process.env.CHATLAB_DATA_DIR,
        }),
      ...(mergeCache && {
        mergeSessionCache: mergeCache,
        streamImport: cliStreamImport,
      }),
      ...(ai && {
        aiDataDir: ai.aiDataDir,
        aiChatManager: ai.aiChatManager,
        assistantManager: ai.assistantManager,
        skillManagerCore: ai.skillManagerCore,
        llmConfigStore: ai.llmConfigStore,
        customProviderStore: ai.customProviderStore,
        customModelStore: ai.customModelStore,
        runAgentStream: ai.runAgentStream,
      }),
    },
    ai ? { requireAi: true } : undefined
  )

  // CLI-specific routes not yet migrated to @openchatlab/http-routes
  registerImportRoutes(server, dbManager)

  server.get('/_web/system/check-update', async () => {
    const currentVersion = getVersion()
    try {
      const resp = await fetch('https://chatlab.fun/latest-version', {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      })
      if (!resp.ok) {
        return { hasUpdate: false, currentVersion, error: `latest-version HTTP ${resp.status}` }
      }
      const data = (await resp.json()) as { version?: string }
      return buildWebUpdateCheckResult({ currentVersion, latestVersion: data.version })
    } catch (err) {
      return {
        hasUpdate: false,
        currentVersion,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  })
}
