/**
 * Legacy Electron storage.json access used while migrating data directories.
 */

import { app } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { PendingDataDirMigration } from '@openchatlab/node-runtime/data-dir-switch'

const STORAGE_CONFIG_FILE = 'storage.json'

/**
 * 旧版存储配置文件路径（userData 根目录）
 */
function getStorageConfigPath(): string {
  try {
    return path.join(app.getPath('userData'), STORAGE_CONFIG_FILE)
  } catch (error) {
    console.error('[Paths] Error getting storage config path:', error)
    return path.join(process.cwd(), STORAGE_CONFIG_FILE)
  }
}

export interface StorageConfig {
  dataDir?: string
  pendingDeleteDir?: string
  pendingDataDirMigration?: PendingDataDirMigration
}

export function readStorageConfig(): StorageConfig {
  const configPath = getStorageConfigPath()
  if (!fs.existsSync(configPath)) return {}

  try {
    const content = fs.readFileSync(configPath, 'utf-8')
    const data = JSON.parse(content) as StorageConfig
    return data || {}
  } catch (error) {
    console.error('[Paths] Error reading storage config:', error)
  }

  return {}
}

export function writeStorageConfig(config: StorageConfig): void {
  const configPath = getStorageConfigPath()
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
  } catch (error) {
    console.error('[Paths] Error writing storage config:', error)
  }
}

/** @deprecated 使用 readStorageConfig 进行迁移检测后废弃 */
export function getCustomDataDir(): string | null {
  const config = readStorageConfig()
  const dataDir = config.dataDir?.trim()
  if (!dataDir) return null
  if (!path.isAbsolute(dataDir)) return null
  return dataDir
}
