/**
 * ChatLab HTTP API — Server lifecycle manager
 *
 * 独立于 Electron 的 HTTP API 服务入口。
 * 使用 DatabaseManager + @openchatlab/core 直接访问数据。
 */

import * as fs from 'fs'
import * as crypto from 'crypto'
import type { FastifyInstance } from 'fastify'
import { loadConfig, writeConfigField, MigrationRunner, ALL_MIGRATIONS } from '@openchatlab/config'
import type { ChatLabConfig } from '@openchatlab/config'
import {
  NodePathProvider,
  DatabaseManager,
  AIChatManager,
  CustomProviderStore,
  CustomModelStore,
  createFileConfigStorage,
  createAuthProfileLlmConfigStore,
  applyPendingNodeDataDirMigrationIfNeeded,
  hasPendingElectronDataWarning,
  verifyCliDataPath,
  createSemanticIndexWorkerRuntimeClient,
  initAppLogger,
  appLogger,
  logNativeParserStatus,
} from '@openchatlab/node-runtime'
import type { SemanticIndexRuntime } from '@openchatlab/node-runtime'
import { createServer } from './server'
import { setAuthToken, setRequireAuth } from './auth'
import { registerWebRoutes } from './routes/web'
import { registerProxyRoutes } from './routes/proxy'
import { initServerAiLogger, closeServerAiLogger } from '../ai/logger'
import { getAssistantManager, getSkillManagerCore } from '../ai/manager-factory'
import { createCliRunAgentStream } from '../ai/agent-stream-runner'
import { initSync, cleanupSync } from '../sync'
import { resolveCliPath } from '../paths'
import { assertCliDataDirCompatible } from '../runtime-compat'

let server: FastifyInstance | null = null
let dbManager: DatabaseManager | null = null
let aiChatManager: AIChatManager | null = null

export interface HttpServerOptions {
  port?: number
  host?: string
  token?: string
  /** dist-web/ 目录路径，启用后托管 Web SPA 静态资源 */
  webRoot?: string
  /** When true, /_web/* also requires Bearer token (for server/headless deployments) */
  requireAuth?: boolean
}

function resolveNativeBinding(): string | undefined {
  if (process.versions.electron) return undefined
  const nativePath = resolveCliPath('native/better_sqlite3.node')
  if (fs.existsSync(nativePath)) return nativePath
  return undefined
}

function ensureToken(config: ChatLabConfig): string {
  if (config.api.token) return config.api.token

  const token = `clb_${crypto.randomBytes(32).toString('hex')}`
  try {
    writeConfigField('api', 'token', token)
  } catch {
    // best-effort: token still usable for this session
  }
  return token
}

/**
 * 启动独立 HTTP API 服务
 */
export async function startHttpServer(options?: HttpServerOptions): Promise<{
  port: number
  host: string
  token: string
}> {
  if (server) {
    throw new Error('HTTP server is already running')
  }

  let config = loadConfig()
  const port = options?.port ?? config.api.port
  const host = options?.host ?? config.api.host
  const token = options?.token ?? ensureToken(config)

  const pendingMigration = applyPendingNodeDataDirMigrationIfNeeded()
  if (!pendingMigration.skipped) {
    if (pendingMigration.success) {
      console.log('[Migration] Pending data directory migration completed')
      config = loadConfig()
    } else {
      console.error('[Migration] Pending data directory migration failed:', pendingMigration.error)
    }
  }

  const userDataDir = config.data.user_data_dir || undefined
  const pathProvider = new NodePathProvider(userDataDir)
  pathProvider.ensureAllDirs()
  const runtime = assertCliDataDirCompatible(pathProvider, 'cli')

  if (hasPendingElectronDataWarning() || !verifyCliDataPath(pathProvider.getDatabaseDir())) {
    console.error(
      '\n' +
        '='.repeat(68) +
        '\n' +
        '  ChatLab: Electron desktop data not found\n' +
        '='.repeat(68) +
        '\n\n' +
        '  Detected that ChatLab desktop app was installed on this machine,\n' +
        '  but could not locate your chat databases.\n\n' +
        '  This usually means you changed the data directory in desktop settings.\n\n' +
        '  To fix this, choose one of:\n\n' +
        '  1. Open ChatLab desktop app — it will auto-migrate your data\n' +
        '  2. Set the data directory manually:\n' +
        '     export CHATLAB_DATA_DIR="/path/to/your/data"\n' +
        '  3. Edit ~/.chatlab/config.toml:\n' +
        '     [data]\n' +
        '     user_data_dir = "/path/to/your/data"\n\n' +
        '='.repeat(68) +
        '\n'
    )
  }

  const migrationRunner = new MigrationRunner(ALL_MIGRATIONS, {
    dataDir: pathProvider.getSystemDir(),
    aiDataDir: pathProvider.getAiDataDir(),
    logger: {
      info: (_cat: string, msg: string) => console.log(`[Migration] ${msg}`),
      warn: (_cat: string, msg: string) => console.warn(`[Migration] ${msg}`),
      error: (_cat: string, msg: string, ...args: unknown[]) => console.error(`[Migration] ${msg}`, ...args),
    },
  })
  await migrationRunner.run()
  const nativeBinding = resolveNativeBinding()
  dbManager = new DatabaseManager(pathProvider, { nativeBinding, runtime })

  const aiDataDir = pathProvider.getAiDataDir()
  aiChatManager = new AIChatManager(aiDataDir, { nativeBinding })

  const assistantManager = getAssistantManager(aiDataDir)
  const skillManagerCore = getSkillManagerCore(aiDataDir)
  const configStorage = createFileConfigStorage(aiDataDir)
  const llmConfigStore = createAuthProfileLlmConfigStore(configStorage)

  initAppLogger(pathProvider.getLogsDir())
  initServerAiLogger(pathProvider.getLogsDir())
  appLogger.info('temp-workspace', 'Temporary workspace initialized', { root: pathProvider.getTempDir() })
  appLogger.info('server', `HTTP server starting on ${host}:${port}`)
  // 记录 Rust native parser 可用性（导入是否走 Rust 内核），便于按日志排查回退原因
  logNativeParserStatus()

  setAuthToken(token)
  setRequireAuth(!!(options?.requireAuth ?? config.api.require_auth))

  server = createServer()

  const multipart = await import('@fastify/multipart')
  await server.register(multipart.default, {
    limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB
  })

  // 语义索引 worker client：启动 HTTP 服务时不拉起 worker；状态/构建/检索按需 lazy start。
  let semanticIndexService: SemanticIndexRuntime | undefined
  try {
    semanticIndexService = createSemanticIndexWorkerRuntimeClient({
      pathProvider,
      runtime,
      nativeBinding,
      workerEntryUrl: import.meta.url.endsWith('.ts')
        ? undefined
        : new URL('./semantic-index-worker.mjs', import.meta.url),
    })
    server.addHook('onClose', async () => semanticIndexService?.close())
  } catch (err) {
    console.warn('[semantic-index] worker client unavailable:', err instanceof Error ? err.message : String(err))
    semanticIndexService = undefined
  }

  registerWebRoutes(server, dbManager, {
    pathProvider,
    nativeBinding,
    runtimeIdentity: runtime,
    semanticIndexService,
    aiContext: {
      aiDataDir,
      aiChatManager,
      assistantManager,
      skillManagerCore,
      llmConfigStore,
      customProviderStore: new CustomProviderStore(configStorage),
      customModelStore: new CustomModelStore(configStorage),
      runAgentStream: createCliRunAgentStream(dbManager, aiChatManager, semanticIndexService),
    },
  })

  initSync(server, dbManager, pathProvider, { port, host, token })

  if (options?.webRoot && fs.existsSync(options.webRoot)) {
    // 注册反向代理：将 /_proxy/chatlab.fun/* 转发至 https://chatlab.fun，
    // 行为与 vite dev proxy 一致，解决浏览器 CORS 问题（见 vite.web.config.mts:138-144）。
    // 必须在 @fastify/static 之前注册，确保显式路由优先于静态文件/SPA fallback。
    registerProxyRoutes(server)
    const fastifyStatic = await import('@fastify/static')
    await server.register(fastifyStatic.default, {
      root: options.webRoot,
      prefix: '/',
      wildcard: false,
    })
    // SPA fallback: 所有非 API/非静态文件路由返回 index.html
    server.setNotFoundHandler(async (_request, reply) => {
      return reply.sendFile('index.html')
    })
  }

  await server.listen({ port, host })

  return { port, host, token }
}

/**
 * 停止 HTTP API 服务
 */
export async function stopHttpServer(): Promise<void> {
  if (!server) return

  try {
    await server.close()
  } finally {
    cleanupSync()
    if (aiChatManager) {
      aiChatManager.close()
      aiChatManager = null
    }
    if (dbManager) {
      dbManager.closeAll()
      dbManager = null
    }
    closeServerAiLogger()
    setRequireAuth(false)
    server = null
  }
}

export { createServer } from './server'
export { registerWebRoutes } from './routes/web'
