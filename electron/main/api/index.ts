/**
 * ChatLab API — 服务管理器
 * 负责 fastify 服务生命周期管理
 */

import type { FastifyInstance } from 'fastify'
import { createServer } from './server'
import { loadConfig, saveConfig, ensureToken, type ApiServerConfig } from './config'
import { registerSystemRoutes } from './routes/system'
import { registerSessionRoutes } from './routes/sessions'

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
    console.log('[ChatLab API] Server already running')
    return
  }

  const config = loadConfig()
  ensureToken(config)
  lastError = null

  try {
    server = createServer()
    registerSystemRoutes(server)
    registerSessionRoutes(server)

    await server.listen({ port: config.port, host: '127.0.0.1' })
    startedAt = Math.floor(Date.now() / 1000)
    console.log(`[ChatLab API] Server started on http://127.0.0.1:${config.port}`)
  } catch (err: any) {
    server = null
    startedAt = null

    if (err.code === 'EADDRINUSE') {
      lastError = `PORT_IN_USE:${config.port}`
      console.warn(`[ChatLab API] Port ${config.port} is already in use`)
    } else {
      lastError = err.message || 'Unknown error'
      console.error('[ChatLab API] Failed to start:', err)
    }
    throw err
  }
}

export async function stop(): Promise<void> {
  if (!server) return

  try {
    await server.close()
  } catch (err) {
    console.error('[ChatLab API] Error closing server:', err)
  } finally {
    server = null
    startedAt = null
    lastError = null
    console.log('[ChatLab API] Server stopped')
  }
}

export async function restart(): Promise<void> {
  await stop()
  await start()
}

/**
 * 应用启动时自动恢复：若配置为 enabled 则尝试启动
 * 失败则静默记录（不影响应用正常使用）
 */
export async function autoStart(): Promise<void> {
  const config = loadConfig()
  if (!config.enabled) return

  try {
    await start()
  } catch {
    // 静默失败，lastError 已记录
  }
}

/**
 * 设置启用状态（持久化）
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
      // lastError 已记录
    }
  } else {
    await stop()
  }

  return getStatus()
}

/**
 * 设置端口（持久化，需要重启服务）
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
      // lastError 已记录
    }
  }

  return getStatus()
}

export function getConfig(): ApiServerConfig {
  return loadConfig()
}
