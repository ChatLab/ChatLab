/**
 * Desktop path resolution and directory creation.
 */

import { app } from 'electron'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { loadConfig, writeConfigField } from '@openchatlab/config'
import { getChatLabTempScopeDir } from '@openchatlab/node-runtime/temp-workspace'
import { ensureMarkerFile } from '../utils/pathUtils'

let _systemDataDir: string | null = null
let _userDataDir: string | null = null

const CHATLAB_MARKER_FILE = '.chatlab'

/**
 * 获取系统数据根目录（固定 ~/.chatlab/）
 */
export function getSystemDataDir(): string {
  if (_systemDataDir) return _systemDataDir
  _systemDataDir = path.join(os.homedir(), '.chatlab')
  return _systemDataDir
}

/**
 * 获取用户数据根目录（可配置）
 *
 * 解析优先级：
 * 1. CHATLAB_DATA_DIR 环境变量
 * 2. ~/.chatlab/config.toml [data] user_data_dir
 * 3. 平台默认路径（首次使用时写入 config.toml）
 */
export function getUserDataDir(): string {
  if (_userDataDir) return _userDataDir

  const envDir = process.env.CHATLAB_DATA_DIR
  if (envDir) {
    _userDataDir = envDir
    return _userDataDir
  }

  const config = loadConfig()
  if (config.data.user_data_dir) {
    _userDataDir = config.data.user_data_dir
    return _userDataDir
  }

  _userDataDir = getDefaultUserDataDir()
  writeConfigField('data', 'user_data_dir', _userDataDir)
  return _userDataDir
}

export function getDefaultUserDataDir(): string {
  return path.join(os.homedir(), '.chatlab', 'data')
}

// ==================== 旧版路径（迁移兼容） ====================

/**
 * 获取 Electron 旧版数据根目录（userData/data）
 * 仅供迁移检测使用，新代码请使用 getSystemDataDir/getUserDataDir
 */
export function getElectronLegacyDataDir(): string {
  try {
    return path.join(app.getPath('userData'), 'data')
  } catch (error) {
    console.error('[Paths] Error getting userData path:', error)
    return path.join(process.cwd(), 'userData', 'data')
  }
}

/**
 * 获取系统下载目录
 * 用于用户导出文件的默认位置
 */
export function getDownloadsDir(): string {
  try {
    return app.getPath('downloads')
  } catch (error) {
    console.error('[Paths] Error getting downloads path:', error)
    return path.join(process.cwd(), 'downloads')
  }
}

export function getDatabaseDir(): string {
  return path.join(getUserDataDir(), 'databases')
}

export function getVectorDir(): string {
  return path.join(getUserDataDir(), 'vector')
}

export function getAiDataDir(): string {
  return path.join(getSystemDataDir(), 'ai')
}

export function getSettingsDir(): string {
  return path.join(getSystemDataDir(), 'settings')
}

export function getCacheDir(): string {
  return path.join(getSystemDataDir(), 'cache')
}

export function getTempDir(): string {
  return getChatLabTempScopeDir('runtime')
}

export function getLogsDir(): string {
  return path.join(getSystemDataDir(), 'logs')
}

/**
 * 确保目录存在
 */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

/**
 * 确保所有应用目录存在（系统数据 + 用户数据）
 */
export function ensureAppDirs(): void {
  ensureDir(getSystemDataDir())
  ensureDir(getUserDataDir())
  ensureDir(getDatabaseDir())
  ensureDir(getVectorDir())
  ensureDir(getAiDataDir())
  ensureDir(getSettingsDir())
  ensureDir(getCacheDir())
  ensureDir(getTempDir())
  ensureDir(getLogsDir())
  ensureMarkerFile(getUserDataDir(), CHATLAB_MARKER_FILE)
}

export function setCachedUserDataDir(userDataDir: string): void {
  _userDataDir = userDataDir
}
