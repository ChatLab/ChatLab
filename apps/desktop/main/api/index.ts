/**
 * ChatLab API — Server manager
 * Manages fastify server lifecycle
 *
 * Uses ConfigManager from @openchatlab/sync (via ipc/api.ts shared instance).
 */

import type { FastifyInstance } from 'fastify'
import { createServer } from './server'
import { registerSystemRoutes } from './routes/system'
import { registerSessionRoutes } from './routes/sessions'
import { registerImportRoutes } from './routes/import'
import { apiLogger } from './logger'
import type { ConfigManager, ApiServerConfig } from '@openchatlab/sync'

let server: FastifyInstance | null = null
let startedAt: number | null = null
let lastError: string | null = null
let runningPort: number | null = null
let _configManager: ConfigManager | null = null

/** Must be called before start/autoStart/setEnabled/setPort */
export function setConfigManager(cm: ConfigManager): void {
  _configManager = cm
}

function cm(): ConfigManager {
  if (!_configManager) throw new Error('[ApiServer] ConfigManager not initialized. Call setConfigManager() first.')
  return _configManager
}

export interface ApiServerStatus {
  running: boolean
  port: number | null
  startedAt: number | null
  error: string | null
}

export function getStatus(): ApiServerStatus {
  return {
    running: server !== null && startedAt !== null,
    port: server !== null && startedAt !== null ? runningPort : null,
    startedAt,
    error: lastError,
  }
}

const PORT_FALLBACK_LIMIT = 10

export async function start(): Promise<void> {
  if (server) {
    apiLogger.info('Server already running')
    return
  }

  const config = cm().load()
  cm().ensureToken(config)
  lastError = null

  const preferredPort = config.port
  let lastErr: any

  for (let offset = 0; offset < PORT_FALLBACK_LIMIT; offset++) {
    const port = preferredPort + offset
    try {
      server = createServer()
      registerSystemRoutes(server)
      registerSessionRoutes(server)
      registerImportRoutes(server)

      await server.listen({ port, host: '127.0.0.1' })
      startedAt = Math.floor(Date.now() / 1000)
      runningPort = port
      if (offset > 0) {
        apiLogger.info(`Port ${preferredPort} in use, bound to http://127.0.0.1:${port} instead`)
      } else {
        apiLogger.info(`Server started on http://127.0.0.1:${port}`)
      }
      return
    } catch (err: any) {
      server = null
      lastErr = err
      if (err.code !== 'EADDRINUSE') break
      apiLogger.warn(`Port ${port} is already in use, trying ${port + 1}…`)
    }
  }

  startedAt = null
  runningPort = null
  if (lastErr?.code === 'EADDRINUSE') {
    lastError = `PORT_IN_USE:${preferredPort}`
    apiLogger.warn(`No available port found starting from ${preferredPort}`)
  } else {
    lastError = lastErr?.message || 'Unknown error'
    apiLogger.error('Failed to start', lastErr)
  }
  throw lastErr
}

export async function stop(): Promise<void> {
  if (!server) return

  try {
    await server.close()
  } catch (err) {
    apiLogger.error('Error closing server', err)
  } finally {
    server = null
    startedAt = null
    runningPort = null
    lastError = null
    apiLogger.info('Server stopped')
  }
}

export async function restart(): Promise<void> {
  await stop()
  await start()
}

/**
 * Auto-restore on app startup: attempt to start if config.enabled is true.
 * Failures are silently recorded (does not affect normal app usage).
 */
export async function autoStart(): Promise<void> {
  const config = cm().load()
  if (!config.enabled) return

  try {
    await start()
  } catch {
    // silent failure, lastError already recorded
  }
}

/**
 * Set enabled state (persisted)
 */
export async function setEnabled(enabled: boolean): Promise<ApiServerStatus> {
  const config = cm().load()
  config.enabled = enabled
  cm().save(config)

  if (enabled) {
    cm().ensureToken(config)
    try {
      await start()
    } catch {
      // lastError already recorded
    }
  } else {
    await stop()
  }

  return getStatus()
}

/**
 * Set port (persisted, requires server restart)
 */
export async function setPort(port: number): Promise<ApiServerStatus> {
  const config = cm().load()
  const wasRunning = server !== null

  config.port = port
  cm().save(config)

  if (wasRunning) {
    await stop()
    try {
      await start()
    } catch {
      // lastError already recorded
    }
  }

  return getStatus()
}

export function getConfig(): ApiServerConfig {
  return cm().load()
}
