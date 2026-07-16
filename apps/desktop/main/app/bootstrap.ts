import { app, dialog } from 'electron'
import { MigrationRunner, ALL_MIGRATIONS } from '@openchatlab/config'
import { appLogger, logNativeParserStatus } from '@openchatlab/node-runtime'
import type { RuntimeIdentity } from '@openchatlab/node-runtime/data-dir-compat'
import { migrateAllDatabases, checkMigrationNeeded } from '../database/core'
import {
  assertDesktopStartupMigrationSucceeded,
  repairDesktopStartupCompatibilityGate,
} from '../database/startup-migration'
import { initLocale } from '../i18n'
import { initProxy } from '../network/proxy'
import { resolveDesktopNativeBinding } from '../runtime/native-sqlite'
import { cleanupPendingDeleteDir, applyPendingDataDirMigration } from '../paths/data-dir-switch'
import {
  needsUnifiedDirMigration,
  migrateToUnifiedDirs,
  verifyDataPath,
  needsLegacyMigration,
  migrateFromLegacyDir,
} from '../paths/legacy-migration'
import { ensureAppDirs, getSystemDataDir, getAiDataDir, getTempDir } from '../paths/locations'
import { getPathProvider } from '../paths/provider'
import { assertDesktopDataDirCompatible, getDesktopAppVersion } from '../runtime/compat'

export async function prepareDesktopRuntime(isTestMode: boolean): Promise<boolean> {
  logNativeParserStatus()

  // Legacy migrations can delete Documents/ChatLab, so isolated E2E runs must skip them.
  if (!isTestMode) {
    applyPendingDataDirMigrationIfNeeded()
    cleanupPendingDeleteDir()
    migrateDataIfNeeded()
    migrateToUnifiedDirsIfNeeded()
  }

  verifyDataPath()
  ensureAppDirs()
  appLogger.info('temp-workspace', 'Temporary workspace initialized', { root: getTempDir() })

  let runtime: RuntimeIdentity
  try {
    runtime = assertDesktopDataDirCompatible(getPathProvider(), getDesktopAppVersion(app.getVersion()))
  } catch (error) {
    console.error('[Main] Data directory compatibility check failed:', error)
    dialog.showErrorBox(
      'ChatLab Data Directory Incompatible',
      `ChatLab cannot open this data directory with the current desktop version.\n\n${
        error instanceof Error ? error.message : String(error)
      }`
    )
    app.quit()
    return false
  }

  await new MigrationRunner(ALL_MIGRATIONS, {
    dataDir: getSystemDataDir(),
    aiDataDir: getAiDataDir(),
    logger: {
      info: (_cat: string, msg: string) => console.log(`[Migration] ${msg}`),
      warn: (_cat: string, msg: string) => console.warn(`[Migration] ${msg}`),
      error: (_cat: string, msg: string, ...args: unknown[]) => console.error(`[Migration] ${msg}`, ...args),
    },
  }).run()

  await initLocale()

  try {
    migrateDatabasesIfNeeded(runtime)
  } catch (error) {
    console.error('[Main] Database schema migration failed:', error)
    dialog.showErrorBox(
      'ChatLab Database Migration Failed',
      `ChatLab cannot start because database migration did not complete safely.\n\n${
        error instanceof Error ? error.message : String(error)
      }`
    )
    app.quit()
    return false
  }

  initProxy()
  return true
}

function applyPendingDataDirMigrationIfNeeded(): void {
  const result = applyPendingDataDirMigration()
  if (result.skipped) {
    console.log('[Main] No pending data directory migration')
    return
  }
  if (result.success) {
    console.log('[Main] Pending data directory migration completed')
  } else {
    console.error('[Main] Pending data directory migration failed:', result.error)
  }
}

function migrateDataIfNeeded(): void {
  if (needsLegacyMigration()) {
    console.log('[Main] Legacy data migration needed, starting migration...')
    const result = migrateFromLegacyDir()
    if (result.success) {
      console.log(`[Main] Migration completed. Migrated: ${result.migratedDirs.join(', ')}`)
    } else {
      console.error('[Main] Migration failed:', result.error)
    }
  } else {
    console.log('[Main] No legacy data migration needed')
  }
}

function migrateToUnifiedDirsIfNeeded(): void {
  if (needsUnifiedDirMigration()) {
    console.log('[Main] Unified directory migration needed, starting...')
    const result = migrateToUnifiedDirs()
    if (result.success) {
      console.log('[Main] Unified directory migration completed')
    } else {
      console.error('[Main] Unified directory migration failed:', result.error)
    }
  } else {
    console.log('[Main] No unified directory migration needed')
  }
}

function migrateDatabasesIfNeeded(runtime: RuntimeIdentity): void {
  const { count } = checkMigrationNeeded()
  if (count > 0) {
    assertDesktopStartupMigrationSucceeded(migrateAllDatabases(runtime))
  }

  repairDesktopStartupCompatibilityGate(runtime, {
    pathProvider: getPathProvider(),
    nativeBinding: resolveDesktopNativeBinding(),
  })
}
