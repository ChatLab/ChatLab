/**
 * MCP Server IPC 处理器
 * 管理 MCP Server 子进程的启动、停止和状态查询
 */

import { ipcMain, app } from 'electron'
import { fork, type ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import { getDatabaseDir, getSettingsDir, ensureDir } from '../paths'
import type { IpcContext } from './types'

/** MCP Server 配置 */
interface McpServerConfig {
  /** 是否启用 MCP Server */
  enabled: boolean
  /** 传输模式：stdio 或 http */
  transport: 'stdio' | 'http'
  /** HTTP 模式端口 */
  port: number
  /** 是否随应用启动 */
  autoStart: boolean
  /** API Key 认证（仅 HTTP 模式） */
  apiKey: string
}

/** MCP Server 运行状态 */
interface McpServerStatus {
  running: boolean
  pid?: number
  transport?: 'stdio' | 'http'
  port?: number
  uptime?: number
  error?: string
}

const DEFAULT_CONFIG: McpServerConfig = {
  enabled: false,
  transport: 'http',
  port: 3000,
  autoStart: false,
  apiKey: '',
}

const CONFIG_FILE = 'mcp-server.json'

let mcpProcess: ChildProcess | null = null
let mcpStartTime: number | null = null
let lastConfig: McpServerConfig = { ...DEFAULT_CONFIG }

/**
 * 获取 MCP Server 可执行文件路径
 */
function getMcpServerEntry(): string {
  // app.getAppPath() returns the project root in dev, or app.asar in production
  const appRoot = app.getAppPath()
  const candidates = [
    // 开发环境：项目根目录下的 packages/mcp-server/dist/index.js
    path.join(appRoot, 'packages', 'mcp-server', 'dist', 'index.js'),
    // 生产环境：extraResources 目录
    path.join(process.resourcesPath || '', 'packages', 'mcp-server', 'dist', 'index.js'),
    path.join(process.resourcesPath || '', 'mcp-server', 'dist', 'index.js'),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  throw new Error(`MCP Server entry not found. Searched: ${candidates.join(', ')}`)
}

/**
 * 读取配置
 */
function loadConfig(): McpServerConfig {
  const configPath = path.join(getSettingsDir(), CONFIG_FILE)
  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8')
      const parsed = JSON.parse(content) as Partial<McpServerConfig>
      lastConfig = { ...DEFAULT_CONFIG, ...parsed }
      return lastConfig
    }
  } catch (error) {
    console.error('[MCP] Failed to load config:', error)
  }
  lastConfig = { ...DEFAULT_CONFIG }
  return lastConfig
}

/**
 * 保存配置
 */
function saveConfig(config: McpServerConfig): void {
  const settingsDir = getSettingsDir()
  ensureDir(settingsDir)
  const configPath = path.join(settingsDir, CONFIG_FILE)
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
    lastConfig = config
  } catch (error) {
    console.error('[MCP] Failed to save config:', error)
    throw error
  }
}

/**
 * 启动 MCP Server
 */
function startServer(config: McpServerConfig): { success: boolean; error?: string } {
  if (mcpProcess && !mcpProcess.killed) {
    return { success: false, error: 'MCP Server is already running' }
  }

  try {
    const entryPath = getMcpServerEntry()
    const dbDir = getDatabaseDir()

    const args = ['--db-dir', dbDir]
    if (config.transport === 'http') {
      args.push('--http', '--port', String(config.port))
      if (config.apiKey) {
        args.push('--api-key', config.apiKey)
      }
    }

    mcpProcess = fork(entryPath, args, {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        CHATLAB_DB_DIR: dbDir,
      },
    })

    mcpStartTime = Date.now()

    mcpProcess.stdout?.on('data', (data: Buffer) => {
      console.log('[MCP stdout]', data.toString().trim())
    })

    mcpProcess.stderr?.on('data', (data: Buffer) => {
      console.log('[MCP stderr]', data.toString().trim())
    })

    mcpProcess.on('error', (err) => {
      console.error('[MCP] Process error:', err)
      mcpProcess = null
      mcpStartTime = null
    })

    mcpProcess.on('exit', (code, signal) => {
      console.log(`[MCP] Process exited (code=${code}, signal=${signal})`)
      mcpProcess = null
      mcpStartTime = null
    })

    console.log(`[MCP] Server started (pid=${mcpProcess.pid}, transport=${config.transport})`)
    return { success: true }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[MCP] Failed to start server:', msg)
    return { success: false, error: msg }
  }
}

/**
 * 停止 MCP Server
 */
function stopServer(): { success: boolean; error?: string } {
  if (!mcpProcess || mcpProcess.killed) {
    mcpProcess = null
    mcpStartTime = null
    return { success: true }
  }

  try {
    mcpProcess.kill('SIGTERM')

    // 5 秒后强制 kill
    const forceKillTimer = setTimeout(() => {
      if (mcpProcess && !mcpProcess.killed) {
        console.warn('[MCP] Force killing server...')
        mcpProcess.kill('SIGKILL')
      }
    }, 5000)

    mcpProcess.on('exit', () => {
      clearTimeout(forceKillTimer)
    })

    mcpProcess = null
    mcpStartTime = null
    return { success: true }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[MCP] Failed to stop server:', msg)
    return { success: false, error: msg }
  }
}

/**
 * 获取运行状态
 */
function getStatus(): McpServerStatus {
  if (mcpProcess && !mcpProcess.killed) {
    return {
      running: true,
      pid: mcpProcess.pid,
      transport: lastConfig.transport,
      port: lastConfig.transport === 'http' ? lastConfig.port : undefined,
      uptime: mcpStartTime ? Date.now() - mcpStartTime : undefined,
    }
  }
  return { running: false }
}

/**
 * 注册 MCP Server IPC 处理器
 */
export function registerMcpHandlers(_context: IpcContext): void {
  console.log('[IpcMain] Registering MCP handlers...')

  // 获取配置
  ipcMain.handle('mcp:getConfig', (): McpServerConfig => {
    return loadConfig()
  })

  // 保存配置
  ipcMain.handle(
    'mcp:saveConfig',
    (_event, config: McpServerConfig): { success: boolean; error?: string } => {
      try {
        saveConfig(config)
        return { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
  )

  // 启动服务
  ipcMain.handle('mcp:start', (): { success: boolean; error?: string } => {
    const config = loadConfig()
    return startServer(config)
  })

  // 停止服务
  ipcMain.handle('mcp:stop', (): { success: boolean; error?: string } => {
    return stopServer()
  })

  // 获取状态
  ipcMain.handle('mcp:getStatus', (): McpServerStatus => {
    return getStatus()
  })

  // 获取 MCP Server 入口路径（用于外部配置 stdio 模式）
  ipcMain.handle('mcp:getServerPath', (): { path: string; dbDir: string } | null => {
    try {
      return {
        path: getMcpServerEntry(),
        dbDir: getDatabaseDir(),
      }
    } catch {
      return null
    }
  })

  // 自动启动
  const config = loadConfig()
  if (config.enabled && config.transport === 'http') {
    console.log('[MCP] Auto-starting server...')
    const result = startServer(config)
    if (!result.success) {
      console.error('[MCP] Auto-start failed:', result.error)
    }
  }

  console.log('[IpcMain] MCP handlers registered')
}

/**
 * 清理 MCP Server 进程
 */
export function cleanupMcpServer(): void {
  stopServer()
}
