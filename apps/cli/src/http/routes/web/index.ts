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
  AIConversationManager,
  AssistantManager,
  SkillManagerCore,
  LLMConfigStore,
  CustomProviderStore,
  CustomModelStore,
} from '@openchatlab/node-runtime'
import { createDatabaseManagerAdapter } from '@openchatlab/node-runtime'
import { registerSharedRoutes } from '@openchatlab/http-routes'
import type { HttpRouteContext } from '@openchatlab/http-routes'
import { MergeSessionCache } from '../../../merger/merge-cache'
import { registerImportRoutes } from './import'
import { openDirectoryPath, showPathInFolder } from './cache'
import { getVersion } from '../../../version'
import { loadConfig } from '@openchatlab/config'

export interface AiContextOptions {
  aiDataDir: string
  convManager: AIConversationManager
  assistantManager: AssistantManager
  skillManagerCore: SkillManagerCore
  llmConfigStore: LLMConfigStore
  customProviderStore: CustomProviderStore
  customModelStore: CustomModelStore
  runAgentStream?: HttpRouteContext['runAgentStream']
}

/**
 * Semver comparison: returns true if `latest` is strictly newer than `current`.
 * Handles pre-release tags (e.g. 0.22.0-beta.1 < 0.22.0).
 */
function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string) => {
    const [core, pre] = v.split('-', 2)
    const parts = core.split('.').map(Number)
    return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0, pre }
  }
  const l = parse(latest)
  const c = parse(current)
  if (l.major !== c.major) return l.major > c.major
  if (l.minor !== c.minor) return l.minor > c.minor
  if (l.patch !== c.patch) return l.patch > c.patch
  // Same core version: stable > pre-release
  // Design note: prerelease-to-prerelease updates are intentionally not surfaced.
  if (c.pre && !l.pre) return true
  return false
}

export function registerWebRoutes(
  server: FastifyInstance,
  dbManager: DatabaseManager,
  options?: { pathProvider?: PathProvider; nativeBinding?: string; aiContext?: AiContextOptions }
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

  const ai = options?.aiContext

  const cliStreamImport = async (dm: typeof dbManager, filePath: string) => {
    const { streamImport } = await import('../../../import/stream-import')
    const result = await streamImport(dm, filePath)
    if (!result.sessionId) throw new Error('Import succeeded but no sessionId returned')
    return { sessionId: result.sessionId }
  }

  const cliConfig = loadConfig()
  const isCustom = Boolean(cliConfig.data.user_data_dir || process.env.CHATLAB_DATA_DIR)

  registerSharedRoutes(
    server,
    {
      dbManager,
      sessionAdapter: adapter,
      pathProvider: resolvedPathProvider,
      getVersion,
      nativeBinding: options?.nativeBinding,
      openDirectory: openDirectoryPath,
      showInFolder: showPathInFolder,
      downloadsDir: resolvedPathProvider.getDownloadsDir(),
      isCustomDataDir: isCustom,
      ...(mergeCache && {
        mergeSessionCache: mergeCache,
        streamImport: cliStreamImport,
      }),
      ...(ai && {
        aiDataDir: ai.aiDataDir,
        conversationManager: ai.convManager,
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
    const packageName = 'chatlab-cli'
    try {
      const resp = await fetch(`https://registry.npmjs.org/${packageName}/latest`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      })
      if (!resp.ok) {
        return { hasUpdate: false, currentVersion, error: `npm registry HTTP ${resp.status}` }
      }
      const data = (await resp.json()) as { version?: string }
      const latestVersion = data.version || currentVersion
      const hasUpdate = isNewerVersion(latestVersion, currentVersion)
      return { hasUpdate, currentVersion, latestVersion }
    } catch (err) {
      return {
        hasUpdate: false,
        currentVersion,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  })
}
