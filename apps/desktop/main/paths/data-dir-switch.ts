/**
 * Desktop data-directory switch lifecycle.
 */

import { app } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { writeConfigField } from '@openchatlab/config'
import {
  createPendingDataDirMigration,
  isDirectoryEmptyOrMissing,
  isExistingUserDataDir,
  isUserDataDirSafeToUse,
  runPendingDataDirMigration,
} from '@openchatlab/node-runtime/data-dir-switch'
import { isInsideAppInstallDir, isPathSafe, isSubPath, writeMigrationLog } from '../utils/pathUtils'
import { ensureDir, getDefaultUserDataDir, getLogsDir, getUserDataDir, setCachedUserDataDir } from './locations'
import { readStorageConfig, writeStorageConfig } from './storage-config'

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
      setCachedUserDataDir(dir)
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
