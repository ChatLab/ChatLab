/**
 * Electron legacy data detection and migration for CLI/Node.js runtime.
 *
 * When a user who has been using the Electron desktop app installs the CLI,
 * this module detects existing Electron data and repoints config.toml
 * so that CLI sees the same databases and configuration.
 *
 * Migration behavior:
 * 1. Detect Electron legacy data directory (platform-specific)
 * 2. If databases exist there, write user_data_dir to config.toml pointing to old path
 * 3. Copy persistent system data (ai, settings, cache, logs, nlp) from old path to ~/.chatlab/
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { writeConfigField } from '@openchatlab/config'

const SYSTEM_SUBDIRS = ['ai', 'settings', 'cache', 'logs', 'nlp']
const STORAGE_CONFIG_FILE = 'storage.json'

interface StorageConfig {
  dataDir?: string
}

/**
 * Get the Electron userData directory path (platform-specific, no Electron dependency).
 *
 * - macOS:   ~/Library/Application Support/ChatLab/
 * - Windows: %APPDATA%/ChatLab/
 * - Linux:   ~/.config/ChatLab/
 */
export function getElectronUserDataDir(
  options: {
    platform?: NodeJS.Platform
    homeDir?: string
    appDataDir?: string
  } = {}
): string {
  const home = options.homeDir ?? os.homedir()
  switch (options.platform ?? process.platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'ChatLab')
    case 'win32': {
      const appData = options.appDataDir ?? process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming')
      return path.join(appData, 'ChatLab')
    }
    default:
      return path.join(home, '.config', 'ChatLab')
  }
}

function readElectronStorageConfig(electronUserData: string): StorageConfig {
  const configPath = path.join(electronUserData, STORAGE_CONFIG_FILE)
  if (!fs.existsSync(configPath)) return {}
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as StorageConfig
  } catch {
    return {}
  }
}

/**
 * Resolve the old Electron data directory, considering storage.json custom paths.
 */
function resolveElectronDataDir(): string {
  const electronUserData = getElectronUserDataDir()
  const storageConfig = readElectronStorageConfig(electronUserData)
  if (storageConfig.dataDir && path.isAbsolute(storageConfig.dataDir)) {
    return storageConfig.dataDir
  }
  return path.join(electronUserData, 'data')
}

function hasDatabases(dir: string): boolean {
  const dbDir = path.join(dir, 'databases')
  if (!fs.existsSync(dbDir)) return false
  try {
    return fs.readdirSync(dbDir).some((f) => f.endsWith('.db'))
  } catch {
    return false
  }
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

function copyDirMerge(src: string, dest: string): { copied: number; skipped: number } {
  const stats = { copied: 0, skipped: 0 }
  if (!fs.existsSync(src)) return stats

  ensureDir(dest)
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(src, { withFileTypes: true })
  } catch {
    return stats
  }

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    try {
      if (entry.isDirectory()) {
        const sub = copyDirMerge(srcPath, destPath)
        stats.copied += sub.copied
        stats.skipped += sub.skipped
      } else if (!fs.existsSync(destPath)) {
        fs.copyFileSync(srcPath, destPath)
        stats.copied++
      } else {
        stats.skipped++
      }
    } catch {
      // Skip files that fail to copy
    }
  }
  return stats
}

function writeMigrationLog(logDir: string, message: string): void {
  try {
    ensureDir(logDir)
    const logPath = path.join(logDir, 'app.log')
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19)
    fs.appendFileSync(logPath, `[${ts}] [MIGRATION] ${message}\n`, 'utf-8')
  } catch {
    // Silent on log failure
  }
}

export interface ElectronMigrationResult {
  migrated: boolean
  userDataDir?: string
  systemDirsCopied?: number
  /** true if Electron userData directory was found (indicating desktop app was used) */
  electronDetected: boolean
  error?: string
}

/**
 * Check if the Electron desktop app was previously used on this machine.
 * Examines the platform-specific Electron userData directory for signs of active use.
 */
export function wasElectronUsed(): boolean {
  const electronUserData = getElectronUserDataDir()
  if (!fs.existsSync(electronUserData)) return false

  // Electron creates these on active use (not just installation)
  return (
    fs.existsSync(path.join(electronUserData, 'Preferences')) ||
    fs.existsSync(path.join(electronUserData, 'Local Storage')) ||
    fs.existsSync(path.join(electronUserData, 'Session Storage')) ||
    fs.existsSync(path.join(electronUserData, 'data'))
  )
}

/**
 * Verify that the resolved database directory actually contains databases.
 * If the directory is empty but Electron was previously used, this indicates
 * a misconfigured data path — the user's databases are somewhere else.
 *
 * @param databaseDir - The databases/ directory path (from PathProvider.getDatabaseDir())
 *
 * Call this AFTER NodePathProvider is initialized, regardless of how
 * the data directory was resolved (config.toml, env var, migration, or default).
 */
export function verifyCliDataPath(databaseDir: string): boolean {
  if (fs.existsSync(databaseDir)) {
    try {
      if (fs.readdirSync(databaseDir).some((f) => f.endsWith('.db'))) return true
    } catch {
      // fall through
    }
  }

  // No databases found — only block if Electron was previously used
  return !wasElectronUsed()
}

/**
 * Detect and migrate Electron legacy data for CLI first-run.
 *
 * Should be called when config.toml has no user_data_dir set (i.e. first run).
 *
 * Possible outcomes:
 * - migrated=true: found Electron databases, config.toml updated
 * - migrated=false, electronDetected=false: no Electron installation found
 * - migrated=false, electronDetected=true: Electron was used but databases not found
 *   (user likely has a custom data directory that we can't locate)
 */
export function migrateFromElectronIfNeeded(systemDir: string): ElectronMigrationResult {
  const electronDataDir = resolveElectronDataDir()

  if (!hasDatabases(electronDataDir)) {
    return { migrated: false, electronDetected: wasElectronUsed() }
  }

  console.log(`[Migration] Detected Electron data at: ${electronDataDir}`)

  try {
    // Step 1: Point config.toml to the Electron data directory (databases stay in place)
    writeConfigField('data', 'user_data_dir', electronDataDir)

    // Step 2: Copy system data from Electron dir to ~/.chatlab/ (merge, don't overwrite)
    let totalCopied = 0
    let totalSkipped = 0
    const movedDirs: string[] = []

    for (const subDir of SYSTEM_SUBDIRS) {
      const srcDir = path.join(electronDataDir, subDir)
      const destDir = path.join(systemDir, subDir)
      if (!fs.existsSync(srcDir)) continue

      const { copied, skipped } = copyDirMerge(srcDir, destDir)
      if (copied > 0 || skipped > 0) {
        movedDirs.push(subDir)
        totalCopied += copied
        totalSkipped += skipped
        console.log(`[Migration] ${subDir}: copied ${copied}, skipped ${skipped}`)
      }
    }

    // Step 3: Remove copied system dirs from old data path (databases stay)
    for (const subDir of movedDirs) {
      const srcDir = path.join(electronDataDir, subDir)
      try {
        fs.rmSync(srcDir, { recursive: true, force: true })
      } catch {
        // Non-critical: old dir remains but won't cause issues
      }
    }

    const logsDir = path.join(systemDir, 'logs')
    const summary =
      `CLI first-run: detected Electron data at ${electronDataDir}, ` +
      `pointed user_data_dir there, copied ${totalCopied} system files (${movedDirs.join(', ') || 'none'})`
    writeMigrationLog(logsDir, summary)
    console.log(`[Migration] ${summary}`)

    return {
      migrated: true,
      electronDetected: true,
      userDataDir: electronDataDir,
      systemDirsCopied: totalCopied,
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    console.error('[Migration] Electron data migration failed:', errorMsg)
    try {
      writeMigrationLog(path.join(systemDir, 'logs'), `Electron migration failed: ${errorMsg}`)
    } catch {
      // Ignore log failure
    }
    return { migrated: false, electronDetected: true, error: errorMsg }
  }
}
