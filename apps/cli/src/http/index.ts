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
  AIConversationManager,
  LLMConfigStore,
  CustomProviderStore,
  CustomModelStore,
  hasPendingElectronDataWarning,
  verifyCliDataPath,
} from '@openchatlab/node-runtime'
import type { ConfigStorage } from '@openchatlab/node-runtime'
import { createServer } from './server'
import { setAuthToken, setRequireAuth } from '@openchatlab/http-routes'
import { registerWebRoutes } from './routes/web'
import { registerProxyRoutes } from './routes/proxy'
import { initServerAiLogger, closeServerAiLogger } from '../ai/logger'
import { getAssistantManager, getSkillManagerCore } from '../ai/manager-factory'
import { createCliRunAgentStream } from '../ai/agent-stream-runner'
import { initSync, cleanupSync } from '../sync'
import { resolveCliPath } from '../paths'
import { resolveApiKey, writeAuthProfile } from '@openchatlab/config'

let server: FastifyInstance | null = null
let dbManager: DatabaseManager | null = null
let convManager: AIConversationManager | null = null

function createFileConfigStorage(aiDataDir: string): ConfigStorage {
  return {
    readJson<T>(key: string): T | null {
      try {
        return JSON.parse(fs.readFileSync(`${aiDataDir}/${key}.json`, 'utf-8')) as T
      } catch {
        return null
      }
    },
    writeJson<T>(key: string, data: T): void {
      if (!fs.existsSync(aiDataDir)) fs.mkdirSync(aiDataDir, { recursive: true })
      fs.writeFileSync(`${aiDataDir}/${key}.json`, JSON.stringify(data, null, 2), 'utf-8')
    },
  }
}

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

  const config = loadConfig()
  const port = options?.port ?? config.api.port
  const host = options?.host ?? config.api.host
  const token = options?.token ?? ensureToken(config)

  const userDataDir = config.data.user_data_dir || undefined
  const pathProvider = new NodePathProvider(userDataDir)
  pathProvider.ensureAllDirs()

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
  dbManager = new DatabaseManager(pathProvider, { nativeBinding })

  const aiDataDir = pathProvider.getAiDataDir()
  convManager = new AIConversationManager(aiDataDir, { nativeBinding })

  const assistantManager = getAssistantManager(aiDataDir)
  const skillManagerCore = getSkillManagerCore(aiDataDir)
  const llmConfigStore = new LLMConfigStore(createFileConfigStorage(aiDataDir), {
    resolveApiKey: (provider, authProfile) => resolveApiKey(provider, authProfile) || undefined,
    onApiKeyCreated: (config, apiKey) => {
      const profileName = config.name?.toLowerCase().replace(/\s+/g, '-') || config.provider
      writeAuthProfile(profileName, { type: 'api_key', provider: config.provider, key: apiKey })
      return profileName
    },
  })

  initServerAiLogger(pathProvider.getLogsDir())

  setAuthToken(token)
  setRequireAuth(!!(options?.requireAuth ?? config.api.require_auth))

  server = createServer()

  const multipart = await import('@fastify/multipart')
  await server.register(multipart.default, {
    limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB
  })

  registerWebRoutes(server, dbManager, {
    pathProvider,
    nativeBinding,
    aiContext: {
      aiDataDir,
      convManager,
      assistantManager,
      skillManagerCore,
      llmConfigStore,
      customProviderStore: new CustomProviderStore(createFileConfigStorage(aiDataDir)),
      customModelStore: new CustomModelStore(createFileConfigStorage(aiDataDir)),
      runAgentStream: createCliRunAgentStream(dbManager, convManager),
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
    if (convManager) {
      convManager.close()
      convManager = null
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
