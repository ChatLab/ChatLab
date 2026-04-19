/**
 * ChatLab API — Server manager
 * Manages fastify server lifecycle
 */

import type { FastifyInstance } from 'fastify'
import { createServer } from './server'
import { loadConfig, saveConfig, ensureToken, type ApiServerConfig } from './config'
import { registerSystemRoutes } from './routes/system'
import { registerSessionRoutes } from './routes/sessions'
import { registerImportRoutes } from './routes/import'
import { apiLogger } from './logger'

let server: FastifyInstance | null = null
let startedAt: number | null = null
let lastError: string | null = null

export interface ApiServerStatus {
  running: boolean
  port: number | null
  startedAt: number | null
  error: string | null
}

export function getStatus(): ApiServerStatus {
  return {
    running: server !== null && startedAt !== null,
    port: server !== null && startedAt !== null ? loadConfig().port : null,
    startedAt,
    error: lastError,
  }
}

export async function start(): Promise<void> {
  if (server) {
    apiLogger.info('Server already running')
    return
  }

  const config = loadConfig()
  ensureToken(config)
  lastError = null

  try {
    server = createServer()
    registerSystemRoutes(server)
    registerSessionRoutes(server)
    registerImportRoutes(server)

    await server.listen({ port: config.port, host: '127.0.0.1' })
    startedAt = Math.floor(Date.now() / 1000)
    apiLogger.info(`Server started on http://127.0.0.1:${config.port}`)
  } catch (err: any) {
    server = null
    startedAt = null

    if (err.code === 'EADDRINUSE') {
      lastError = `PORT_IN_USE:${config.port}`
      apiLogger.warn(`Port ${config.port} is already in use`)
    } else {
      lastError = err.message || 'Unknown error'
      apiLogger.error('Failed to start', err)
    }
    throw err
  }
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
  const config = loadConfig()
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
  const config = loadConfig()
  config.enabled = enabled
  saveConfig(config)

  if (enabled) {
    ensureToken(config)
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
  const config = loadConfig()
  const wasRunning = server !== null

  config.port = port
  saveConfig(config)

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
  return loadConfig()
}
