/**
 * PathProvider 的 Node.js 独立实现
 *
 * 为 CLI / npm 服务版提供路径管理，不依赖 Electron。
 *
 * 目录分为两类：
 * - 系统数据：固定在 ~/.chatlab/，存放配置、日志、缓存、AI 数据等
 * - 用户数据：可配置位置，存放聊天记录数据库等核心资产
 *
 * 用户数据目录（userDataDir）解析优先级：
 * 1. 构造函数传入的 userDataDir 参数
 * 2. CHATLAB_DATA_DIR 环境变量
 * 3. ~/.chatlab/config.toml → [data] user_data_dir
 * 4. 平台默认路径
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { PathProvider } from '@openchatlab/core'
import { writeConfigField, loadConfig } from '@openchatlab/config'
import { migrateFromElectronIfNeeded } from './migrations/electron-data-migration'
import { applyPendingNodeDataDirMigration } from './data-dir-switch'

const SYSTEM_DIR = path.join(os.homedir(), '.chatlab')

/**
 * Set after resolveUserDataDir() detects Electron installation but cannot find databases.
 * CLI should check this and block execution with instructions.
 */
let _pendingElectronDataWarning = false

export function hasPendingElectronDataWarning(): boolean {
  return _pendingElectronDataWarning
}

export function applyPendingNodeDataDirMigrationIfNeeded(): { success: boolean; skipped?: boolean; error?: string } {
  if (process.env.CHATLAB_DATA_DIR) return { success: true, skipped: true }
  return applyPendingNodeDataDirMigration(SYSTEM_DIR)
}

export class NodePathProvider implements PathProvider {
  private systemDir: string
  private userDataDir: string

  constructor(userDataDir?: string) {
    this.systemDir = SYSTEM_DIR
    this.userDataDir = userDataDir || resolveUserDataDir()
  }

  getSystemDir(): string {
    return this.systemDir
  }

  getUserDataDir(): string {
    return this.userDataDir
  }

  getDatabaseDir(): string {
    return path.join(this.userDataDir, 'databases')
  }

  getAiDataDir(): string {
    return path.join(this.systemDir, 'ai')
  }

  getSettingsDir(): string {
    return path.join(this.systemDir, 'settings')
  }

  getCacheDir(): string {
    return path.join(this.systemDir, 'cache')
  }

  getTempDir(): string {
    return path.join(this.systemDir, 'temp')
  }

  getLogsDir(): string {
    return path.join(this.systemDir, 'logs')
  }

  getDownloadsDir(): string {
    return path.join(os.homedir(), 'Downloads')
  }

  /**
   * 确保系统目录和用户数据目录都存在
   */
  ensureAllDirs(): void {
    const dirs = [
      this.systemDir,
      this.userDataDir,
      this.getDatabaseDir(),
      this.getAiDataDir(),
      this.getSettingsDir(),
      this.getCacheDir(),
      this.getTempDir(),
      this.getLogsDir(),
    ]
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
    }
  }
}

function resolveUserDataDir(): string {
  const envDir = process.env.CHATLAB_DATA_DIR
  if (envDir) {
    return expandHome(envDir)
  }

  const config = loadConfig()
  if (config.data.user_data_dir) {
    return expandHome(config.data.user_data_dir)
  }

  // First run: check for existing Electron desktop data before using default
  const result = migrateFromElectronIfNeeded(SYSTEM_DIR)
  if (result.migrated && result.userDataDir) {
    return result.userDataDir
  }

  const defaultDir = getDefaultNodeUserDataDir()

  if (result.electronDetected) {
    // Electron was used but we couldn't find databases — likely a custom data directory.
    // Don't persist default to config.toml so migration retries on next startup.
    _pendingElectronDataWarning = true
    return defaultDir
  }

  writeConfigField('data', 'user_data_dir', defaultDir)
  return defaultDir
}

export function getDefaultNodeUserDataDir(): string {
  return path.join(os.homedir(), '.chatlab', 'data')
}

function expandHome(filePath: string): string {
  if (filePath.startsWith('~/') || filePath === '~') {
    return path.join(os.homedir(), filePath.slice(1))
  }
  return filePath
}
