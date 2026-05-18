/**
 * ChatLab HTTP API — Server lifecycle manager
 *
 * 独立于 Electron 的 HTTP API 服务入口。
 * 使用 DatabaseManager + @openchatlab/core 直接访问数据。
 */

import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import type { FastifyInstance } from 'fastify'
import { loadConfig, getConfigDir, MigrationRunner, ALL_MIGRATIONS } from '@openchatlab/config'
import type { ChatLabConfig } from '@openchatlab/config'
import { NodePathProvider, DatabaseManager, AIConversationManager } from '@openchatlab/node-runtime'
import { createServer } from './server'
import { setAuthToken } from './auth'
import { registerSystemRoutes } from './routes/system'
import { registerSessionRoutes } from './routes/sessions'
import { registerWebRoutes } from './routes/web'
import { registerNlpRoutes } from './routes/nlp'
import { registerAiRoutes } from './routes/ai'
import { initServerAiLogger, closeServerAiLogger } from '../ai/logger'
import { initSync, cleanupSync } from '../sync'

let server: FastifyInstance | null = null
let dbManager: DatabaseManager | null = null
let convManager: AIConversationManager | null = null

export interface HttpServerOptions {
  port?: number
  host?: string
  token?: string
  /** dist-web/ 目录路径，启用后托管 Web SPA 静态资源 */
  webRoot?: string
}

function resolveNativeBinding(): string | undefined {
  if (process.versions.electron) return undefined
  const nativePath = path.resolve(__dirname, '../../native/better_sqlite3.node')
  if (fs.existsSync(nativePath)) return nativePath
  return undefined
}

function ensureToken(config: ChatLabConfig): string {
  if (config.api.token) return config.api.token

  const token = `clb_${crypto.randomBytes(32).toString('hex')}`
  const configDir = getConfigDir()
  const configPath = path.join(configDir, 'config.toml')
  try {
    let content = ''
    if (fs.existsSync(configPath)) {
      content = fs.readFileSync(configPath, 'utf-8')
    }
    if (!content.includes('[api]')) {
      content += `\n[api]\ntoken = "${token}"\n`
    } else {
      content = content.replace(/\[api\]/, `[api]\ntoken = "${token}"`)
    }
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(configPath, content, 'utf-8')
  } catch {
    // 写入失败时仍使用生成的 token 运行本次会话
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
  convManager = new AIConversationManager(pathProvider.getAiDataDir(), { nativeBinding })

  initServerAiLogger(pathProvider.getLogsDir())

  setAuthToken(token)

  server = createServer()

  const multipart = await import('@fastify/multipart')
  await server.register(multipart.default, {
    limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB
  })

  registerSystemRoutes(server, dbManager)
  registerSessionRoutes(server, dbManager)
  registerNlpRoutes(server, dbManager)
  registerAiRoutes(server, dbManager, convManager)
  registerWebRoutes(server, dbManager, { pathProvider, nativeBinding })

  initSync(server, dbManager, pathProvider, { port, host, token })

  // 托管 Web SPA 静态资源
  if (options?.webRoot && fs.existsSync(options.webRoot)) {
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
    server = null
  }
}

export { createServer } from './server'
export { registerSystemRoutes } from './routes/system'
export { registerSessionRoutes } from './routes/sessions'
export { registerWebRoutes } from './routes/web'
export { registerNlpRoutes } from './routes/nlp'
export { registerAiRoutes } from './routes/ai'
