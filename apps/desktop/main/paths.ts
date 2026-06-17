/**
 * 统一路径管理模块
 *
 * 目录分为两类：
 * 1. 系统数据（~/.chatlab/）— 固定位置，不可更改
 *    配置、日志、缓存、AI 数据、设置偏好等
 * 2. 用户核心数据（userDataDir）— 可通过 config.toml 配置
 *    聊天记录数据库、向量库（未来）
 *
 * userDataDir 解析优先级：
 *   CHATLAB_DATA_DIR 环境变量 > config.toml [data] user_data_dir > 平台默认
 *
 * 平台默认 userDataDir：
 * - macOS: ~/Documents/ChatLab/
 * - Windows: %USERPROFILE%\Documents\ChatLab\
 * - Linux: ~/ChatLab/
 *
 * Electron 旧版数据目录（迁移用）：
 * - Windows: %APPDATA%/ChatLab/data
 * - macOS: ~/Library/Application Support/ChatLab/data
 * - Linux: ~/.config/ChatLab/data
 */

import { app } from 'electron'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { loadConfig, writeConfigField } from '@openchatlab/config'
import {
  copyDirMerge,
  copyDirRecursive,
  ensureMarkerFile,
  isInsideAppInstallDir,
  isPathSafe,
  isSubPath,
  writeMigrationLog,
} from './utils/pathUtils'
import { shouldMarkUnifiedDirMigrationDone } from './utils/unifiedDirMigration'
import {
  createPendingDataDirMigration,
  isDirectoryEmptyOrMissing,
  isExistingUserDataDir,
  isUserDataDirSafeToUse,
  runPendingDataDirMigration,
  type PendingDataDirMigration,
} from './utils/dataDirSwitch'

// 缓存路径，避免重复计算
let _systemDataDir: string | null = null
let _userDataDir: string | null = null
let _legacyDataDir: string | null = null

// 旧版存储配置文件名（迁移兼容用）
const STORAGE_CONFIG_FILE = 'storage.json'

// ChatLab 数据目录标记文件（用于更严格的目录识别）
const CHATLAB_MARKER_FILE = '.chatlab'

// ==================== 新路径体系 ====================

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

interface StorageConfig {
  dataDir?: string
  pendingDeleteDir?: string
  pendingDataDirMigration?: PendingDataDirMigration
}

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

function writeStorageConfig(config: StorageConfig): void {
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

/**
 * 设置用户数据目录
 * @param dataDir 目标目录（为空则恢复默认）
 * @param migrate 是否迁移现有数据（合并复制，不会覆盖目标文件）
 */
export function setCustomDataDir(
  dataDir: string | null,
  migrate: boolean = true
): { success: boolean; error?: string; from?: string; to?: string; requiresRelaunch?: boolean } {
  const normalized = typeof dataDir === 'string' ? dataDir.trim() : ''
  const oldDir = getUserDataDir()

  try {
    if (process.env.CHATLAB_DATA_DIR) {
      return { success: false, error: 'CHATLAB_DATA_DIR 已设置，不能在界面中切换数据目录' }
    }

    const newDir = normalized || getDefaultUserDataDir()

    if (!path.isAbsolute(newDir)) {
      return { success: false, error: '数据目录必须是绝对路径' }
    }

    if (migrate && oldDir !== newDir && isSubPath(oldDir, newDir)) {
      return { success: false, error: '目标目录不能是当前数据目录的子目录' }
    }

    if (!isPathSafe(newDir)) {
      return { success: false, error: '不能使用系统关键目录作为数据目录' }
    }

    try {
      const exePath = app.getPath('exe')
      if (isInsideAppInstallDir(newDir, exePath)) {
        return { success: false, error: '不能将数据目录放在应用安装目录下，应用更新时该目录会被清空' }
      }
    } catch {
      // 获取 exe 路径失败时跳过此检查
    }

    if (!isUserDataDirSafeToUse(newDir)) {
      return { success: false, error: '目标目录不为空且不包含 ChatLab 数据，请选择空目录或已有数据目录' }
    }

    if (path.resolve(oldDir) === path.resolve(newDir)) {
      const config = readStorageConfig()
      writeStorageConfig({ ...config, pendingDataDirMigration: undefined })
      return { success: true, from: oldDir, to: newDir, requiresRelaunch: false }
    }

    const config = readStorageConfig()
    const pending = createPendingDataDirMigration({
      from: oldDir,
      to: newDir,
      migrate,
      targetWasEmpty: isDirectoryEmptyOrMissing(newDir),
    })
    writeStorageConfig({ ...config, pendingDataDirMigration: pending })

    return { success: true, from: oldDir, to: newDir, requiresRelaunch: true }
  } catch (error) {
    console.error('[Paths] Error setting custom data dir:', error)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function applyPendingDataDirMigration(): { success: boolean; skipped?: boolean; error?: string } {
  const config = readStorageConfig()
  const pending = config.pendingDataDirMigration
  if (!pending) return { success: true, skipped: true }

  const result = runPendingDataDirMigration(pending, {
    writeUserDataDir(dir) {
      writeConfigField('data', 'user_data_dir', dir)
      writeConfigField('data', 'electron_migration_done', true)
      _userDataDir = dir
    },
    clearPendingMigration() {
      const latest = readStorageConfig()
      writeStorageConfig({ ...latest, pendingDataDirMigration: undefined })
    },
    markPendingDeleteDir(dir) {
      const latest = readStorageConfig()
      writeStorageConfig({ ...latest, pendingDeleteDir: dir })
    },
    log(message) {
      writeMigrationLog(getLogsDir(), message, ensureDir)
    },
  })

  if (!result.success) {
    const error = result.errors.join('; ') || '数据目录迁移失败'
    console.warn('[Paths] Pending data dir migration failed:', error)
    writeMigrationLog(
      getLogsDir(),
      `切换目录迁移失败: 从 ${pending.from} 到 ${pending.to}，复制 ${result.copied} 项，跳过 ${result.skipped} 项，错误 ${result.errors.length} 项: ${error}`,
      ensureDir
    )
    return { success: false, error }
  }

  writeMigrationLog(
    getLogsDir(),
    `切换目录迁移成功: 从 ${pending.from} 到 ${pending.to}，复制 ${result.copied} 项，跳过 ${result.skipped} 项`,
    ensureDir
  )
  return { success: true }
}

/**
 * 清理待删除的旧数据目录（应用启动时调用）
 */
export function cleanupPendingDeleteDir(): void {
  try {
    const config = readStorageConfig()
    const pendingDir = config.pendingDeleteDir

    if (!pendingDir) return

    const currentDir = getUserDataDir()

    if (pendingDir === currentDir) {
      console.log('[Paths] Skipping cleanup: pending dir is same as current dir')
      writeStorageConfig({ ...config, pendingDeleteDir: undefined })
      return
    }

    if (!isPathSafe(pendingDir)) {
      console.log('[Paths] Skipping cleanup: pending dir is a system directory:', pendingDir)
      writeStorageConfig({ ...config, pendingDeleteDir: undefined })
      return
    }

    if (fs.existsSync(pendingDir) && !isExistingUserDataDir(pendingDir)) {
      console.log('[Paths] Skipping cleanup: pending dir is not a ChatLab data dir:', pendingDir)
      writeStorageConfig({ ...config, pendingDeleteDir: undefined })
      return
    }

    if (!fs.existsSync(pendingDir)) {
      console.log('[Paths] Pending dir does not exist, skipping cleanup:', pendingDir)
      writeStorageConfig({ ...config, pendingDeleteDir: undefined })
      return
    }

    console.log('[Paths] Cleaning up old data directory:', pendingDir)
    fs.rmSync(pendingDir, { recursive: true, force: true })
    console.log('[Paths] Old data directory deleted:', pendingDir)

    writeStorageConfig({ ...config, pendingDeleteDir: undefined })
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
  return path.join(getSystemDataDir(), 'temp')
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
  const newDir = getUserDataDir()

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

// ==================== Electron 旧目录结构 → 新目录结构迁移 ====================

const SYSTEM_SUBDIRS = ['ai', 'settings', 'cache', 'logs', 'temp', 'nlp']

/**
 * 检测是否需要从 Electron 旧目录结构迁移到新的双根目录结构
 *
 * 判断条件：
 * - 旧 Electron 数据路径存在数据库文件
 * - 且当前 user_data_dir 没有指向旧 Electron 路径（即数据库还未被纳入）
 *
 * 注意：不能仅靠 user_data_dir 是否存在来判断，因为 CLI 可能先于
 * Electron 启动并写入了默认值 ~/.chatlab/data，导致迁移被跳过。
 */
export function needsUnifiedDirMigration(): boolean {
  const config = loadConfig()
  if (config.data.electron_migration_done) return false

  const oldDataDir = resolveOldElectronDataDir()
  const oldDbDir = path.join(oldDataDir, 'databases')
  if (!fs.existsSync(oldDbDir)) return false

  const hasDb = fs.readdirSync(oldDbDir).some((f) => f.endsWith('.db'))
  if (!hasDb) return false

  const currentUserDataDir = config.data.user_data_dir || getDefaultUserDataDir()
  if (path.resolve(currentUserDataDir) === path.resolve(oldDataDir)) return false

  return true
}

/**
 * 解析 Electron 旧数据目录（考虑 storage.json 自定义路径）
 */
function resolveOldElectronDataDir(): string {
  const storageConfig = readStorageConfig()
  if (storageConfig.dataDir && path.isAbsolute(storageConfig.dataDir)) {
    return storageConfig.dataDir
  }
  return getElectronLegacyDataDir()
}

/**
 * 执行从 Electron 旧目录结构到新双根目录结构的迁移
 *
 * 迁移步骤：
 * 1. 创建 ~/.chatlab/ 目录
 * 2. 如果当前 user_data_dir 下有数据库，合并到旧 Electron 路径
 * 3. 将旧数据路径写入 config.toml [data] user_data_dir
 * 4. 复制系统数据到 ~/.chatlab/（合并，不覆盖已有）
 * 5. 验证复制成功
 * 6. 删除旧路径下的系统数据
 * 7. 留 MOVED.txt 说明文件
 */
export function migrateToUnifiedDirs(): { success: boolean; error?: string } {
  const oldDataDir = resolveOldElectronDataDir()
  const systemDir = getSystemDataDir()

  console.log(`[Migration] Starting unified dir migration: ${oldDataDir} → ${systemDir}`)

  try {
    // Step 1: 创建系统目录
    ensureDir(systemDir)

    // Step 2: 如果当前 user_data_dir 指向了别处（如 CLI 写入的默认路径），
    // 且那里有数据库，先合并到旧 Electron 路径
    const config = loadConfig()
    const prevUserDataDir = config.data.user_data_dir
    if (prevUserDataDir && path.resolve(prevUserDataDir) !== path.resolve(oldDataDir)) {
      const prevDbDir = path.join(prevUserDataDir, 'databases')
      const oldDbDir = path.join(oldDataDir, 'databases')
      if (fs.existsSync(prevDbDir)) {
        const dbFiles = fs.readdirSync(prevDbDir).filter((f) => f.endsWith('.db'))
        if (dbFiles.length > 0) {
          ensureDir(oldDbDir)
          const result = copyDirMerge(prevDbDir, oldDbDir, ensureDir)
          console.log(
            `[Migration] Merged ${result.copied} databases from ${prevDbDir} to ${oldDbDir} (skipped ${result.skipped})`
          )
        }
      }
    }

    // Step 3: 写入 config.toml（数据库保留在旧 Electron 路径）
    writeConfigField('data', 'user_data_dir', oldDataDir)
    _userDataDir = oldDataDir

    // 如果 storage.json 有自定义 dataDir，也记录日志
    const storageConfig = readStorageConfig()
    if (storageConfig.dataDir) {
      console.log(`[Migration] Migrated storage.json custom path: ${storageConfig.dataDir}`)
    }

    // Step 4: 复制系统数据（合并，不覆盖 ~/.chatlab/ 下已有的文件）
    const movedDirs: string[] = []
    const failedDirs: string[] = []

    for (const subDir of SYSTEM_SUBDIRS) {
      const srcDir = path.join(oldDataDir, subDir)
      const destDir = path.join(systemDir, subDir)

      if (!fs.existsSync(srcDir)) continue

      try {
        ensureDir(destDir)
        const mergeResult = copyDirMerge(srcDir, destDir, ensureDir)

        if (mergeResult.copied > 0 || mergeResult.skipped > 0) {
          movedDirs.push(subDir)
          console.log(`[Migration] ${subDir}: copied ${mergeResult.copied}, skipped ${mergeResult.skipped}`)
        }
      } catch (err) {
        console.error(`[Migration] Failed to copy ${subDir}:`, err)
        failedDirs.push(subDir)
      }
    }

    // Step 5: 删除旧路径下的系统数据（仅成功复制的目录）
    for (const subDir of movedDirs) {
      const srcDir = path.join(oldDataDir, subDir)
      try {
        fs.rmSync(srcDir, { recursive: true, force: true })
      } catch (err) {
        console.warn(`[Migration] Failed to remove old ${subDir}:`, err)
      }
    }

    // Step 6: 留说明文件
    const movedTxt = [
      `ChatLab Data Migration - ${new Date().toISOString()}`,
      '',
      'System data has been moved to: ' + systemDir,
      'User data (databases) remains in this directory.',
      '',
      `Moved directories: ${movedDirs.join(', ') || 'none'}`,
      `Failed directories: ${failedDirs.join(', ') || 'none'}`,
    ].join('\n')
    fs.writeFileSync(path.join(oldDataDir, 'MOVED.txt'), movedTxt, 'utf-8')

    const summary = `Unified dir migration: ${movedDirs.length} dirs moved, ${failedDirs.length} failed`
    writeMigrationLog(getLogsDir(), summary, ensureDir)
    console.log(`[Migration] ${summary}`)

    if (shouldMarkUnifiedDirMigrationDone(failedDirs)) {
      writeConfigField('data', 'electron_migration_done', true)
    }

    return { success: failedDirs.length === 0 }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    console.error('[Migration] Unified dir migration failed:', errorMsg)
    try {
      writeMigrationLog(getLogsDir(), `Unified dir migration failed: ${errorMsg}`, ensureDir)
    } catch {
      // 日志写入失败时忽略
    }
    return { success: false, error: errorMsg }
  }
}

/**
 * Verify that the configured user_data_dir actually has database files.
 * If the configured dir is empty but the old Electron path has databases,
 * auto-correct config.toml to point to the old path.
 *
 * This acts as a safety net in case migration was skipped or config was overwritten.
 */
export function verifyDataPath(): void {
  const currentDir = getUserDataDir()
  const currentDbDir = path.join(currentDir, 'databases')
  const hasCurrentDbs = fs.existsSync(currentDbDir) && fs.readdirSync(currentDbDir).some((f) => f.endsWith('.db'))

  if (hasCurrentDbs) return

  const oldDir = getElectronLegacyDataDir()
  if (path.resolve(currentDir) === path.resolve(oldDir)) return

  const oldDbDir = path.join(oldDir, 'databases')
  if (!fs.existsSync(oldDbDir)) return

  const hasOldDbs = fs.readdirSync(oldDbDir).some((f) => f.endsWith('.db'))
  if (!hasOldDbs) return

  console.warn(
    `[Paths] Data path mismatch: configured dir ${currentDir} has no databases, but old path ${oldDir} does. Auto-correcting config.toml.`
  )
  writeConfigField('data', 'user_data_dir', oldDir)
  _userDataDir = oldDir
}
