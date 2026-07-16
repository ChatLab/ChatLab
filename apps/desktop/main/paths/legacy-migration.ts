/**
 * Legacy desktop directory migrations and recovery checks.
 */

import { app } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { loadConfig, writeConfigField } from '@openchatlab/config'
import { copyDirMerge, copyDirRecursive, writeMigrationLog } from '../utils/pathUtils'
import { shouldMarkUnifiedDirMigrationDone } from '../utils/unifiedDirMigration'
import {
  ensureDir,
  getDefaultUserDataDir,
  getElectronLegacyDataDir,
  getLogsDir,
  getSystemDataDir,
  getUserDataDir,
  setCachedUserDataDir,
} from './locations'
import { readStorageConfig } from './storage-config'

let _legacyDataDir: string | null = null

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
 * 迁移整个目录的持久内容，采用合并策略：只复制不存在的文件，不覆盖已存在的文件。
 * 旧 temp 目录只包含可重建的临时数据，不复制到新的正式数据目录。
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
    const dirsToMigrate = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'temp')
      .map((e) => e.name)
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

const SYSTEM_SUBDIRS = ['ai', 'settings', 'cache', 'logs', 'nlp']

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
    setCachedUserDataDir(oldDataDir)

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
  setCachedUserDataDir(oldDir)
}
