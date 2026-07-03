/**
 * CLI runtime bootstrap: config load, data dir migration/compat checks,
 * DatabaseManager construction. Shared by legacy commands and query commands.
 */

import * as fs from 'fs'
import { loadConfig } from '@openchatlab/config'
import {
  NodePathProvider,
  DatabaseManager,
  applyPendingNodeDataDirMigrationIfNeeded,
  hasPendingElectronDataWarning,
  verifyCliDataPath,
} from '@openchatlab/node-runtime'
import { resolveCliPath } from './paths'
import { assertCliDataDirCompatible } from './runtime-compat'

/**
 * Resolve standalone better-sqlite3 native module path.
 * Used in non-Electron environments to avoid electron-rebuild conflicts.
 */
export function resolveNativeBinding(): string | undefined {
  if (process.versions.electron) return undefined
  const nativePath = resolveCliPath('native/better_sqlite3.node')
  if (fs.existsSync(nativePath)) return nativePath
  return undefined
}

export function initRuntime() {
  let config = loadConfig()
  const pendingMigration = applyPendingNodeDataDirMigrationIfNeeded()
  if (!pendingMigration.skipped) {
    if (pendingMigration.success) {
      // stderr: stdout must stay parseable for agent/json consumers (design §6.2)
      console.error('[Migration] Pending data directory migration completed')
      config = loadConfig()
    } else {
      console.error('[Migration] Pending data directory migration failed:', pendingMigration.error)
    }
  }
  const userDataDir = config.data.user_data_dir || undefined
  const pathProvider = new NodePathProvider(userDataDir)
  pathProvider.ensureAllDirs()
  const runtime = assertCliDataDirCompatible(pathProvider, 'cli')

  if (hasPendingElectronDataWarning() || !verifyCliDataPath(pathProvider.getDatabaseDir())) {
    printElectronDataError()
    process.exit(1)
  }

  const nativeBinding = resolveNativeBinding()
  const dbManager = new DatabaseManager(pathProvider, { nativeBinding, runtime })
  return { config, pathProvider, dbManager }
}

function printElectronDataError(): void {
  console.error('\n' + '='.repeat(68))
  console.error('  ChatLab: Electron desktop data not found')
  console.error('='.repeat(68))
  console.error('')
  console.error('  Detected that ChatLab desktop app was installed on this machine,')
  console.error('  but could not locate your chat databases.')
  console.error('')
  console.error('  This usually means you changed the data directory in desktop settings.')
  console.error('')
  console.error('  To fix this, choose one of:')
  console.error('')
  console.error('  1. Open ChatLab desktop app — it will auto-migrate your data')
  console.error('  2. Set the data directory manually:')
  console.error('     export CHATLAB_DATA_DIR="/path/to/your/data"')
  console.error('  3. Edit ~/.chatlab/config.toml:')
  console.error('     [data]')
  console.error('     user_data_dir = "/path/to/your/data"')
  console.error('')
  console.error('='.repeat(68) + '\n')
}
