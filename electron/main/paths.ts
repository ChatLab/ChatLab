/**
 * 统一路径管理模块
 * 所有应用数据存储在 app.getPath('userData') 目录下
 *
 * 各平台路径：
 * - Windows: %APPDATA%/ChatLab (例如 C:\Users\xxx\AppData\Roaming\ChatLab)
 * - macOS: ~/Library/Application Support/ChatLab
 * - Linux: ~/.config/ChatLab
 */

import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import {
  copyDirMerge,
  copyDirRecursive,
  ensureMarkerFile,
  isDirectorySafeToUse,
  isExistingChatLabDir,
  isPathSafe,
  isSubPath,
  writeMigrationLog,
} from './utils/pathUtils'

// 缓存路径，避免重复计算
let _appDataDir: string | null = null
let _legacyDataDir: string | null = null

// 存储配置文件名（放在 userData 根目录，避免受自定义数据目录影响）
const STORAGE_CONFIG_FILE = 'storage.json'

// ChatLab 数据目录标记文件（用于更严格的目录识别）
const CHATLAB_MARKER_FILE = '.chatlab'
// ChatLab 数据目录关键子目录（用于识别已有数据）
const CHATLAB_REQUIRED_DIRS = ['databases', 'settings']

/**
 * 获取应用数据根目录
 * 使用 userData/data 子目录，与 Electron 缓存隔离
 */
export function getAppDataDir(): string {
  if (_appDataDir) return _appDataDir

  // 优先读取用户自定义数据目录
  const customDir = getCustomDataDir()
  if (customDir) {
    _appDataDir = customDir
    return _appDataDir
  }

  // 回退到默认路径
  _appDataDir = getDefaultAppDataDir()
  return _appDataDir
}

/**
 * 获取默认的数据根目录（userData/data）
 */
function getDefaultAppDataDir(): string {
  try {
    const userDataPath = app.getPath('userData')
    // 使用子目录存放应用数据，避免与 Electron 缓存混淆
    return path.join(userDataPath, 'data')
  } catch (error) {
    console.error('[Paths] Error getting userData path:', error)
    return path.join(process.cwd(), 'userData', 'data')
  }
}

/**
 * 获取存储配置文件路径（userData 根目录）
 */
function getStorageConfigPath(): string {
  try {
    return path.join(app.getPath('userData'), STORAGE_CONFIG_FILE)
  } catch (error) {
    console.error('[Paths] Error getting storage config path:', error)
    return path.join(process.cwd(), STORAGE_CONFIG_FILE)
  }
}

/**
 * 存储配置接口
 */
interface StorageConfig {
  dataDir?: string
  // 待删除的旧目录（下次启动时清理）
  pendingDeleteDir?: string
}

/**
 * 读取存储配置
 */
function readStorageConfig(): StorageConfig {
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

/**
 * 保存存储配置
 */
function writeStorageConfig(config: StorageConfig): void {
  const configPath = getStorageConfigPath()
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
  } catch (error) {
    console.error('[Paths] Error writing storage config:', error)
  }
}

/**
 * 获取用户自定义数据目录
 */
export function getCustomDataDir(): string | null {
  const config = readStorageConfig()
  const dataDir = config.dataDir?.trim()
  if (!dataDir) return null

  // 只接受绝对路径
  if (!path.isAbsolute(dataDir)) {
    console.warn('[Paths] Invalid custom data dir (not absolute):', dataDir)
    return null
  }

  return dataDir
}

/**
 * 设置自定义数据目录
 * @param dataDir 目标目录（为空则恢复默认）
 * @param migrate 是否迁移现有数据（合并复制，不会覆盖目标文件）
 */
export function setCustomDataDir(
  dataDir: string | null,
  migrate: boolean = true
): { success: boolean; error?: string; from?: string; to?: string } {
  const normalized = typeof dataDir === 'string' ? dataDir.trim() : ''
  const oldDir = getAppDataDir()

  try {
    if (!normalized) {
      // 恢复默认路径
      const newDir = getDefaultAppDataDir()

      // 防止目标目录是当前目录的子目录，避免递归复制
      if (migrate && oldDir !== newDir && isSubPath(oldDir, newDir)) {
        return { success: false, error: '目标目录不能是当前数据目录的子目录' }
      }

      // 先清除自定义配置，切回默认目录
      writeStorageConfig({})
      _appDataDir = newDir

      let canDeleteOldDir = false
      if (migrate && oldDir !== newDir) {
        const migrateResult = copyDirMerge(oldDir, newDir, ensureDir)
        console.log(
          `[Paths] 数据迁移完成: 复制 ${migrateResult.copied} 项, 跳过 ${migrateResult.skipped} 项, 错误 ${migrateResult.errors.length} 项`
        )
        if (migrateResult.errors.length > 0) {
          console.warn('[Paths] Errors during migration:', migrateResult.errors)
          console.warn('[Paths] Migration failed, old data directory will not be deleted')
          // 迁移失败日志写入 app.log
          writeMigrationLog(
            getLogsDir(),
            `切换为默认目录迁移失败: 从 ${oldDir} 到 ${newDir}，复制 ${migrateResult.copied} 项，跳过 ${migrateResult.skipped} 项，错误 ${migrateResult.errors.length} 项`,
            ensureDir
          )
        } else {
          canDeleteOldDir = true
          // 迁移成功日志写入 app.log
          writeMigrationLog(
            getLogsDir(),
            `切换为默认目录迁移成功: 从 ${oldDir} 到 ${newDir}，复制 ${migrateResult.copied} 项，跳过 ${migrateResult.skipped} 项`,
            ensureDir
          )
        }
      }

      // 迁移成功才标记删除旧目录，避免数据丢失
      if (canDeleteOldDir) {
        writeStorageConfig({ pendingDeleteDir: oldDir })
      }

      return { success: true, from: oldDir, to: newDir }
    }

    if (!path.isAbsolute(normalized)) {
      return { success: false, error: '数据目录必须是绝对路径' }
    }

    // 防止目标目录是当前目录的子目录，避免递归复制
    if (migrate && oldDir !== normalized && isSubPath(oldDir, normalized)) {
      return { success: false, error: '目标目录不能是当前数据目录的子目录' }
    }

    // 安全检查：不能使用系统关键目录
    if (!isPathSafe(normalized)) {
      return { success: false, error: '不能使用系统关键目录作为数据目录' }
    }

    // 安全检查：目标目录应为空或已有 ChatLab 数据
    if (!isDirectorySafeToUse(normalized, CHATLAB_MARKER_FILE, CHATLAB_REQUIRED_DIRS)) {
      return { success: false, error: '目标目录不为空且不包含 ChatLab 数据，请选择空目录或已有数据目录' }
    }

    // 确保目录存在
    ensureDir(normalized)

    _appDataDir = normalized

    let canDeleteOldDir = false
    if (migrate && oldDir !== normalized) {
      const migrateResult = copyDirMerge(oldDir, normalized, ensureDir)
      console.log(
        `[Paths] 数据迁移完成: 复制 ${migrateResult.copied} 项, 跳过 ${migrateResult.skipped} 项, 错误 ${migrateResult.errors.length} 项`
      )
      if (migrateResult.errors.length > 0) {
        console.warn('[Paths] Errors during migration:', migrateResult.errors)
        console.warn('[Paths] Migration failed, old data directory will not be deleted')
        // 迁移失败日志写入 app.log
        writeMigrationLog(
          getLogsDir(),
          `切换目录迁移失败: 从 ${oldDir} 到 ${normalized}，复制 ${migrateResult.copied} 项，跳过 ${migrateResult.skipped} 项，错误 ${migrateResult.errors.length} 项`,
          ensureDir
        )
      } else {
        canDeleteOldDir = true
        // 迁移成功日志写入 app.log
        writeMigrationLog(
          getLogsDir(),
          `切换目录迁移成功: 从 ${oldDir} 到 ${normalized}，复制 ${migrateResult.copied} 项，跳过 ${migrateResult.skipped} 项`,
          ensureDir
        )
      }
    }

    // 迁移成功才标记删除旧目录，避免数据丢失
    const config: StorageConfig = { dataDir: normalized }
    if (canDeleteOldDir) {
      config.pendingDeleteDir = oldDir
    }
    writeStorageConfig(config)

    return { success: true, from: oldDir, to: normalized }
  } catch (error) {
    console.error('[Paths] Error setting custom data dir:', error)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * 清理待删除的旧数据目录（应用启动时调用）
 */
export function cleanupPendingDeleteDir(): void {
  try {
    const config = readStorageConfig()
    const pendingDir = config.pendingDeleteDir

    if (!pendingDir) return

    // 获取当前数据目录
    const currentDir = getAppDataDir()

    // 安全检查：不能删除当前正在使用的目录
    if (pendingDir === currentDir) {
      console.log('[Paths] Skipping cleanup: pending dir is same as current dir')
      // 清除待删除标记
      writeStorageConfig({ dataDir: config.dataDir })
      return
    }

    // 安全检查：不能删除系统关键目录
    if (!isPathSafe(pendingDir)) {
      console.log('[Paths] Skipping cleanup: pending dir is a system directory:', pendingDir)
      // 清除待删除标记
      writeStorageConfig({ dataDir: config.dataDir })
      return
    }

    // 安全检查：确保待删除目录确实是 ChatLab 数据目录（标记文件 + 关键子目录）
    if (fs.existsSync(pendingDir) && !isExistingChatLabDir(pendingDir, CHATLAB_MARKER_FILE, CHATLAB_REQUIRED_DIRS)) {
      console.log('[Paths] Skipping cleanup: pending dir is not a ChatLab data dir:', pendingDir)
      // 清除待删除标记
      writeStorageConfig({ dataDir: config.dataDir })
      return
    }

    // 检查目录是否存在
    if (!fs.existsSync(pendingDir)) {
      console.log('[Paths] Pending dir does not exist, skipping cleanup:', pendingDir)
      // 清除待删除标记
      writeStorageConfig({ dataDir: config.dataDir })
      return
    }

    // 删除旧目录
    console.log('[Paths] Cleaning up old data directory:', pendingDir)
    fs.rmSync(pendingDir, { recursive: true, force: true })
    console.log('[Paths] Old data directory deleted:', pendingDir)

    // 清除待删除标记
    writeStorageConfig({ dataDir: config.dataDir })
  } catch (error) {
    console.error('[Paths] Failed to clean up old directory:', error)
  }
}

/**
 * 获取旧版数据目录（Documents/ChatLab）
 * 用于数据迁移检测
 */
export function getLegacyDataDir(): string {
  if (_legacyDataDir) return _legacyDataDir

  try {
    const docPath = app.getPath('documents')
    _legacyDataDir = path.join(docPath, 'ChatLab')
  } catch (error) {
    console.error('[Paths] Error getting documents path:', error)
    _legacyDataDir = path.join(process.cwd(), 'ChatLab')
  }

  return _legacyDataDir
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

/**
 * 获取数据库目录
 */
export function getDatabaseDir(): string {
  return path.join(getAppDataDir(), 'databases')
}

/**
 * 获取 AI 数据目录（对话历史、LLM 配置）
 */
export function getAiDataDir(): string {
  return path.join(getAppDataDir(), 'ai')
}

/**
 * 获取设置目录
 */
export function getSettingsDir(): string {
  return path.join(getAppDataDir(), 'settings')
}

/**
 * 获取临时文件目录
 */
export function getTempDir(): string {
  return path.join(getAppDataDir(), 'temp')
}

/**
 * 获取日志目录
 */
export function getLogsDir(): string {
  return path.join(getAppDataDir(), 'logs')
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
 * 确保所有应用目录存在
 */
export function ensureAppDirs(): void {
  ensureDir(getDatabaseDir())
  ensureDir(getAiDataDir())
  ensureDir(getSettingsDir())
  ensureDir(getTempDir())
  ensureDir(getLogsDir())
  // 写入数据目录标记文件
  ensureMarkerFile(getAppDataDir(), CHATLAB_MARKER_FILE)
}

// ==================== 数据迁移 ====================

/**
 * 检查是否需要从 Documents/ChatLab 迁移数据
 */
export function needsLegacyMigration(): boolean {
  const legacyDir = getLegacyDataDir()

  // 检查 Documents/ChatLab 是否存在
  if (fs.existsSync(legacyDir)) {
    return true
  }

  return false
}

/**
 * 从指定源目录迁移数据到目标目录
 * 采用合并策略：只复制不存在的文件，不覆盖已存在的文件
 */
function migrateDirectory(
  srcDir: string,
  destDir: string,
  subDirs: string[]
): { migratedDirs: string[]; skippedDirs: string[] } {
  const migratedDirs: string[] = []
  const skippedDirs: string[] = []

  for (const subDir of subDirs) {
    const srcSubPath = path.join(srcDir, subDir)
    const destSubPath = path.join(destDir, subDir)

    // 如果源子目录不存在或为空，跳过
    if (!fs.existsSync(srcSubPath)) {
      continue
    }

    const srcFiles = fs.readdirSync(srcSubPath).filter((f) => !f.startsWith('.'))
    if (srcFiles.length === 0) {
      continue
    }

    // 确保目标子目录存在
    ensureDir(destSubPath)

    // 获取目标目录中已存在的文件
    const existingFiles = new Set(fs.readdirSync(destSubPath))

    // 合并策略：只复制目标目录中不存在的文件
    let copiedCount = 0
    let skippedCount = 0

    for (const file of srcFiles) {
      const srcPath = path.join(srcSubPath, file)
      const destPath = path.join(destSubPath, file)

      // 如果目标文件已存在，跳过（不覆盖）
      if (existingFiles.has(file)) {
        console.log(`[Paths] Skipping ${subDir}/${file}: already exists in destination`)
        skippedCount++
        continue
      }

      const stat = fs.statSync(srcPath)
      if (stat.isDirectory()) {
        copyDirRecursive(srcPath, destPath, ensureDir)
      } else {
        fs.copyFileSync(srcPath, destPath)
      }
      copiedCount++
    }

    if (copiedCount > 0) {
      migratedDirs.push(subDir)
      console.log(`[Paths] Migrated ${subDir}: ${copiedCount} items copied, ${skippedCount} skipped`)
    } else if (skippedCount > 0) {
      skippedDirs.push(subDir)
      console.log(`[Paths] ${subDir}: all ${skippedCount} items already exist in destination`)
    }
  }

  return { migratedDirs, skippedDirs }
}

/**
 * 执行从 Documents/ChatLab 到新目录的数据迁移
 * 迁移整个目录的所有内容，采用合并策略：只复制不存在的文件，不覆盖已存在的文件
 * 只有在所有数据都成功迁移后才删除旧目录
 */
export function migrateFromLegacyDir(): { success: boolean; migratedDirs: string[]; error?: string } {
  const legacyDir = getLegacyDataDir()
  const newDir = getAppDataDir()

  try {
    if (!fs.existsSync(legacyDir)) {
      return { success: true, migratedDirs: [] }
    }

    // 获取旧目录下的所有子目录和文件
    const entries = fs.readdirSync(legacyDir, { withFileTypes: true })
    const dirsToMigrate = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name)
    const filesToMigrate = entries.filter((e) => e.isFile() && !e.name.startsWith('.')).map((e) => e.name)

    const result = migrateDirectory(legacyDir, newDir, dirsToMigrate)

    // 迁移根目录下的文件
    ensureDir(newDir)
    for (const file of filesToMigrate) {
      const srcPath = path.join(legacyDir, file)
      const destPath = path.join(newDir, file)
      if (!fs.existsSync(destPath)) {
        fs.copyFileSync(srcPath, destPath)
      }
    }

    // 构建迁移摘要
    const summary: string[] = []
    summary.push(`Migration from ${legacyDir} to ${newDir}`)

    // 迁移成功，删除旧目录
    fs.rmSync(legacyDir, { recursive: true, force: true })
    summary.push('Status: Success, legacy directory removed')

    if (result.migratedDirs.length > 0) {
      summary.push(`Migrated dirs: ${result.migratedDirs.join(', ')}`)
    }
    if (filesToMigrate.length > 0) {
      summary.push(`Migrated files: ${filesToMigrate.length}`)
    }

    // 写入迁移日志
    writeMigrationLog(getLogsDir(), summary.join(' | '), ensureDir)

    return { success: true, migratedDirs: result.migratedDirs }
  } catch (error) {
    console.error('[Paths] Migration failed:', error)
    const errorMsg = error instanceof Error ? error.message : String(error)
    writeMigrationLog(getLogsDir(), `Migration failed: ${errorMsg}`, ensureDir)
    return {
      success: false,
      migratedDirs: [],
      error: errorMsg,
    }
  }
}

/**
 * 删除旧版数据目录（可选，供用户确认后调用）
 */
export function removeLegacyDir(): boolean {
  const legacyDir = getLegacyDataDir()

  if (!fs.existsSync(legacyDir)) {
    return true
  }

  try {
    fs.rmSync(legacyDir, { recursive: true, force: true })
    console.log(`[Paths] Removed legacy directory: ${legacyDir}`)
    return true
  } catch (error) {
    console.error('[Paths] Failed to remove legacy directory:', error)
    return false
  }
}
