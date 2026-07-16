/**
 * Electron Internal API Server
 *
 * Provides HTTP-based business communication for the Renderer process,
 * reusing @openchatlab/http-routes shared routes with ephemeral auth.
 *
 * Completely isolated from the user-facing External API Server
 * (apps/desktop/main/api/). Different port, different token, different lifecycle.
 */

import * as path from 'node:path'
import { randomBytes } from 'node:crypto'
import { app, ipcMain, shell } from 'electron'
import type { FastifyInstance } from 'fastify'
import type { PathProvider } from '@openchatlab/core'
import {
  DatabaseManager,
  createDatabaseManagerAdapter,
  CustomProviderStore,
  CustomModelStore,
  createFileConfigStorage,
  createAuthProfileLlmConfigStore,
  MergeSessionCache,
  withDataDirImportLock,
  raiseChatDbCompatibilityGate,
  streamingImport,
  createSemanticIndexWorkerRuntimeClient,
  appLogger,
} from '@openchatlab/node-runtime'
import type { StreamImportDeps, SemanticIndexRuntime } from '@openchatlab/node-runtime'
import { getLoadablePath as getSqliteVecLoadablePath } from 'sqlite-vec'
import multipart from '@fastify/multipart'
import { registerSharedRoutes, registerAutomationRoutes } from '@openchatlab/http-routes'
import { createApiServer } from '@openchatlab/http-routes/server'
import type { HttpRouteContext } from '@openchatlab/http-routes'
import { reloadTimer, stopTimer, type DataSourceManager, type PullEngine } from '@openchatlab/sync'
import { getManager as getAIChatManager } from '../ai/chats'
import { getManager as getAssistantManager } from '../ai/assistant/manager'
import { getManager as getSkillManager } from '../ai/skills/manager'
import { aiLogger } from '../ai/logger'
import { createElectronRunAgentStream } from '../ai/agent-stream-runner'
import { createExecuteElectronAiTool } from '../ai/tools/debug-executor'
import { assertDesktopDataDirCompatible, getDesktopAppVersion } from '../runtime/compat'
import { resolveDesktopNativeBinding } from '../runtime/native-sqlite'
import { resolveModelDownloadProxyUrl } from '../network/proxy'
import { getDefaultUserDataDir, getDownloadsDir, getUserDataDir } from '../paths/locations'
import { configureInternalHttpServer } from './http'

export interface InternalEndpoint {
  baseUrl: string
  token: string
}

let server: FastifyInstance | null = null
let endpoint: InternalEndpoint | null = null
let dbManager: DatabaseManager | null = null
let mergeCache: MergeSessionCache | null = null
let semanticIndexService: SemanticIndexRuntime | null = null

const JSON_BODY_LIMIT = 50 * 1024 * 1024 // 50 MB

interface InternalServerDependencies {
  getDataSourceManager(): DataSourceManager
  getPullEngine(): PullEngine
}

/**
 * Start the Internal API Server.
 * Must be called before createWindow() so the Renderer can retrieve the endpoint.
 */
export async function startInternalServer(
  pathProvider: PathProvider,
  dependencies: InternalServerDependencies
): Promise<InternalEndpoint> {
  if (server) return endpoint!

  let newServer: FastifyInstance | null = null
  let newDbManager: DatabaseManager | null = null
  let newSemanticIndexService: SemanticIndexRuntime | null = null

  try {
    const token = `int_${randomBytes(32).toString('hex')}`
    const runtime = assertDesktopDataDirCompatible(pathProvider, getDesktopAppVersion(app.getVersion()))
    const nativeBinding = resolveDesktopNativeBinding()

    newDbManager = new DatabaseManager(pathProvider, { runtime, nativeBinding })
    const sessionAdapter = createDatabaseManagerAdapter(newDbManager)

    const aiDataDir = pathProvider.getAiDataDir()
    const configStorage = createFileConfigStorage(aiDataDir)
    const llmConfigStore = createAuthProfileLlmConfigStore(configStorage)

    const newMergeCache = new MergeSessionCache(pathProvider, { nativeBinding })
    newMergeCache.cleanupOrphans()

    // 语义索引 worker client：启动 internal server 时不拉起 worker；状态/构建/检索按需 lazy start。
    try {
      newSemanticIndexService = createSemanticIndexWorkerRuntimeClient({
        pathProvider,
        runtime,
        nativeBinding,
        sqliteVecLoadablePath: getSqliteVecLoadablePath().replace('app.asar', 'app.asar.unpacked'),
        getModelDownloadProxyUrl: resolveModelDownloadProxyUrl,
        workerEntryUrl: import.meta.url.endsWith('.ts')
          ? undefined
          : new URL('./semantic-index-worker.js', import.meta.url),
      })
    } catch (err) {
      console.warn('[semantic-index] worker client unavailable:', err instanceof Error ? err.message : String(err))
      newSemanticIndexService = null
    }

    const electronStreamImport = async (dm: DatabaseManager, filePath: string) => {
      return withDataDirImportLock(dm.getUserDataDir(), async () => {
        const deps: StreamImportDeps = {
          openDatabase(sessionId: string) {
            return dm.openRawSessionDatabase(sessionId, { create: true, initializeChatTables: true })
          },
          deleteDatabase(sessionId: string) {
            dm.deleteSessionDatabaseFiles(sessionId)
          },
          onProgress() {
            /* no progress for merge-triggered import */
          },
        }
        const result = await streamingImport(filePath, deps)
        if (!result.success) throw new Error(result.error || 'Import failed')
        if (!result.sessionId) throw new Error('Import succeeded but no sessionId returned')
        try {
          raiseChatDbCompatibilityGate(pathProvider, runtime)
        } catch (error) {
          dm.deleteSessionDatabaseFiles(result.sessionId)
          throw error
        }
        return { sessionId: result.sessionId }
      })
    }

    const routeDbManager = newDbManager

    const ctx: HttpRouteContext = {
      dbManager: newDbManager,
      sessionAdapter,
      pathProvider,
      runtimeIdentity: runtime,
      nativeBinding,
      getVersion: () => getDesktopAppVersion(app.getVersion()),
      mergeSessionCache: newMergeCache,
      streamImport: electronStreamImport,
      aiDataDir,
      aiChatManager: getAIChatManager(),
      assistantManager: getAssistantManager(),
      skillManagerCore: getSkillManager(),
      llmConfigStore,
      customProviderStore: new CustomProviderStore(configStorage),
      customModelStore: new CustomModelStore(configStorage),
      getCurrentAiLogPath: () => aiLogger.getExistingLogPath(),
      automation: {
        dsManager: dependencies.getDataSourceManager(),
        pullEngine: dependencies.getPullEngine(),
        deleteSessionData: (sessionId) => routeDbManager.deleteSessionDatabaseFiles(sessionId),
        reloadTimer,
        stopTimer,
      },
      semanticIndexService: newSemanticIndexService ?? undefined,
      openDirectory: (dirPath) => shell.openPath(dirPath).then(() => {}),
      showInFolder: (filePath) => {
        shell.showItemInFolder(filePath)
        return Promise.resolve()
      },
      downloadsDir: getDownloadsDir(),
      defaultUserDataDir: getDefaultUserDataDir(),
      isCustomDataDir: path.resolve(getUserDataDir()) !== path.resolve(getDefaultUserDataDir()),
      runAgentStream: createElectronRunAgentStream(newSemanticIndexService ?? undefined),
      executeAiTool: createExecuteElectronAiTool(newSemanticIndexService ?? undefined),
    }

    newServer = createApiServer({
      bodyLimit: JSON_BODY_LIMIT,
      onUnhandledError: (request, error) => {
        appLogger.error('http', `${request.method} ${request.url} -> 500`, error)
      },
    })

    await newServer.register(multipart, { limits: { fileSize: 1024 * 1024 * 1024 } })
    configureInternalHttpServer(newServer, {
      token,
      isDev: !app.isPackaged,
      devOrigin: process.env.ELECTRON_RENDERER_URL || 'http://localhost:13100',
    })

    registerSharedRoutes(newServer, ctx, { requireAi: true })
    registerAutomationRoutes(newServer, ctx)

    await newServer.listen({ port: 0, host: '127.0.0.1' })

    const address = newServer.server.address()
    const port = typeof address === 'object' && address ? address.port : 0

    server = newServer
    dbManager = newDbManager
    mergeCache = newMergeCache
    semanticIndexService = newSemanticIndexService
    endpoint = { baseUrl: `http://127.0.0.1:${port}`, token }
    console.log(`[InternalAPI] Server started on port ${port}`)

    return endpoint
  } catch (err) {
    try {
      await newServer?.close()
    } catch {
      /* best-effort */
    }
    try {
      newDbManager?.closeAll()
    } catch {
      /* best-effort */
    }
    try {
      await newSemanticIndexService?.close()
    } catch {
      /* best-effort */
    }
    server = null
    dbManager = null
    mergeCache = null
    semanticIndexService = null
    endpoint = null
    throw err
  }
}

export function getInternalEndpoint(): InternalEndpoint | null {
  return endpoint
}

/** Main-process DatabaseManager backing the internal server (null before startup). */
export function getInternalDbManager(): DatabaseManager | null {
  return dbManager
}

/** Lazy semantic-index runtime backing the internal server (null before startup / unavailable). */
export function getInternalSemanticIndexService(): SemanticIndexRuntime | null {
  return semanticIndexService
}

export async function stopInternalServer(): Promise<void> {
  if (!server) return
  try {
    await server.close()
  } catch (err) {
    console.error('[InternalAPI] Error closing server:', err)
  } finally {
    try {
      mergeCache?.clear()
    } catch {
      /* best-effort */
    }
    try {
      dbManager?.closeAll()
    } catch {
      /* best-effort */
    }
    try {
      await semanticIndexService?.close()
    } catch {
      /* best-effort */
    }
    server = null
    endpoint = null
    dbManager = null
    mergeCache = null
    semanticIndexService = null
    console.log('[InternalAPI] Server stopped')
  }
}

/**
 * Register IPC handler so the Renderer can retrieve the endpoint via preload.
 * Must be called before createWindow().
 */
export function registerInternalApiIpc(): void {
  ipcMain.handle('internal-api:getEndpoint', () => getInternalEndpoint())
}
