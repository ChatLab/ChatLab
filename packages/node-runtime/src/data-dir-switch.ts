import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'node:crypto'
import { writeConfigField } from '@openchatlab/config'
import { appLogger } from './logging/app-logger'

const CHATLAB_MARKER_FILE = '.chatlab'
const USER_DATA_REQUIRED_DIRS = ['databases']
const PENDING_MIGRATION_FILE = 'data-dir-migration.json'
const PENDING_CLEANUPS_FILE = 'data-dir-cleanups.json'

const DANGEROUS_PATHS = [
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\ProgramData',
  '/usr',
  '/etc',
  '/bin',
  '/sbin',
  '/lib',
  '/var',
  '/boot',
  '/root',
  '/System',
  '/Library',
]

export interface CopyStats {
  copied: number
  skipped: number
  errors: string[]
}

export interface PendingDataDirMigration {
  from: string
  to: string
  migrate: boolean
  /** Legacy field retained so older runtimes also leave the source directory untouched. */
  deleteSourceOnSuccess: boolean
  createdAt: string
}

export interface RunPendingDataDirMigrationDeps {
  copyDirMerge?: typeof copyDirMerge
  ensureDir?: (dirPath: string) => void
  writeUserDataDir: (dir: string) => void
  clearPendingMigration: () => void
  recordPendingCleanup?: (sourceDir: string, targetDir: string) => void
  log?: (message: string) => void
}

export interface PendingDataDirCleanup {
  id: string
  sourceDir: string
  targetDir: string
  createdAt: string
  noticeDismissed: boolean
}

interface PendingDataDirCleanupFile {
  version: 1
  entries: PendingDataDirCleanup[]
}

export interface RunPendingDataDirMigrationResult {
  success: boolean
  from: string
  to: string
  copied: number
  skipped: number
  errors: string[]
}

export interface DataDirSwitchResult {
  success: boolean
  error?: string
  from?: string
  to?: string
  requiresRelaunch?: boolean
}

export interface ApplyPendingNodeDataDirMigrationDeps {
  writeConfigField?: typeof writeConfigField
}

export interface DeletePendingDataDirCleanupDeps {
  removeDir?: (dir: string) => void
}

function normalizePathForCompare(input: string): string {
  const resolved = path.resolve(input)
  const normalized = path.normalize(resolved)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function isSubPath(parent: string, child: string): boolean {
  const parentPath = normalizePathForCompare(parent)
  const childPath = normalizePathForCompare(child)

  if (parentPath === childPath) return false
  return childPath.startsWith(`${parentPath}${path.sep}`)
}

function isPathSafe(targetPath: string): boolean {
  const normalizedTarget = targetPath.toLowerCase().replace(/\//g, '\\')

  for (const dangerous of DANGEROUS_PATHS) {
    const normalizedDangerous = dangerous.toLowerCase().replace(/\//g, '\\')
    if (normalizedTarget.startsWith(normalizedDangerous)) {
      return false
    }
  }

  return true
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

function hasChatLabUserDataStructure(entries: string[]): boolean {
  return entries.includes(CHATLAB_MARKER_FILE) && USER_DATA_REQUIRED_DIRS.every((dir) => entries.includes(dir))
}

function hasChatLabDatabaseFiles(dirPath: string, entries?: string[]): boolean {
  const dirEntries = entries ?? fs.readdirSync(dirPath)
  if (!dirEntries.includes('databases')) return false

  const dbDir = path.join(dirPath, 'databases')
  try {
    return fs.existsSync(dbDir) && fs.readdirSync(dbDir).some((file) => file.endsWith('.db'))
  } catch {
    return false
  }
}

export function isExistingUserDataDir(dirPath: string): boolean {
  if (!fs.existsSync(dirPath)) return false

  try {
    const entries = fs.readdirSync(dirPath)
    return hasChatLabUserDataStructure(entries) || hasChatLabDatabaseFiles(dirPath, entries)
  } catch {
    return false
  }
}

export function isUserDataDirSafeToUse(dirPath: string): boolean {
  if (!fs.existsSync(dirPath)) return true

  try {
    const entries = fs.readdirSync(dirPath)
    if (entries.length === 0) return true
    return hasChatLabUserDataStructure(entries) || hasChatLabDatabaseFiles(dirPath, entries)
  } catch {
    return false
  }
}

export function isDirectoryEmptyOrMissing(dirPath: string): boolean {
  if (!fs.existsSync(dirPath)) return true

  try {
    return fs.readdirSync(dirPath).length === 0
  } catch {
    return false
  }
}

export function copyDirMerge(
  src: string,
  dest: string,
  mkdir: (dirPath: string) => void = ensureDir,
  stats: CopyStats = { copied: 0, skipped: 0, errors: [] }
): CopyStats {
  if (!fs.existsSync(src)) return stats

  try {
    mkdir(dest)
    const entries = fs.readdirSync(src, { withFileTypes: true })

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name)
      const destPath = path.join(dest, entry.name)

      try {
        if (entry.isDirectory()) {
          copyDirMerge(srcPath, destPath, mkdir, stats)
        } else if (!fs.existsSync(destPath)) {
          fs.copyFileSync(srcPath, destPath)
          stats.copied++
        } else {
          stats.skipped++
        }
      } catch (error) {
        stats.errors.push(`复制失败: ${srcPath} -> ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  } catch (error) {
    stats.errors.push(`读取目录失败: ${src} -> ${error instanceof Error ? error.message : String(error)}`)
  }

  return stats
}

export function createPendingDataDirMigration(input: {
  from: string
  to: string
  migrate: boolean
  targetWasEmpty: boolean
}): PendingDataDirMigration {
  return {
    from: input.from,
    to: input.to,
    migrate: input.migrate,
    deleteSourceOnSuccess: false,
    createdAt: new Date().toISOString(),
  }
}

export function runPendingDataDirMigration(
  pending: PendingDataDirMigration,
  deps: RunPendingDataDirMigrationDeps
): RunPendingDataDirMigrationResult {
  const copy = deps.copyDirMerge ?? copyDirMerge
  const mkdir = deps.ensureDir ?? ensureDir

  let stats: CopyStats = { copied: 0, skipped: 0, errors: [] }
  if (pending.migrate && path.resolve(pending.from) !== path.resolve(pending.to)) {
    if (!fs.existsSync(pending.from)) {
      return {
        success: false,
        from: pending.from,
        to: pending.to,
        copied: 0,
        skipped: 0,
        errors: [`源数据目录不存在: ${pending.from}`],
      }
    }

    stats = copy(pending.from, pending.to, mkdir)
    deps.log?.(
      `数据目录迁移完成: 从 ${pending.from} 到 ${pending.to}，复制 ${stats.copied} 项，跳过 ${stats.skipped} 项，错误 ${stats.errors.length} 项`
    )
    if (stats.errors.length > 0) {
      return {
        success: false,
        from: pending.from,
        to: pending.to,
        copied: stats.copied,
        skipped: stats.skipped,
        errors: stats.errors,
      }
    }
  } else {
    mkdir(pending.to)
  }

  deps.writeUserDataDir(pending.to)

  // Skipped files may leave unique data in either directory, so cleanup records stay unchanged; deletion revalidates active paths.
  if (pending.migrate && path.resolve(pending.from) !== path.resolve(pending.to) && stats.skipped === 0) {
    deps.recordPendingCleanup?.(pending.from, pending.to)
  } else if (stats.skipped > 0) {
    deps.log?.(
      `Old data directory retained without cleanup registration because ${stats.skipped} target file(s) were skipped`
    )
  }
  deps.clearPendingMigration()

  return {
    success: true,
    from: pending.from,
    to: pending.to,
    copied: stats.copied,
    skipped: stats.skipped,
    errors: [],
  }
}

function getPendingMigrationPath(systemDir: string): string {
  return path.join(systemDir, 'settings', PENDING_MIGRATION_FILE)
}

function getPendingCleanupsPath(systemDir: string): string {
  return path.join(systemDir, 'settings', PENDING_CLEANUPS_FILE)
}

function isPendingDataDirCleanup(value: unknown): value is PendingDataDirCleanup {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<PendingDataDirCleanup>
  return (
    typeof entry.id === 'string' &&
    typeof entry.sourceDir === 'string' &&
    path.isAbsolute(entry.sourceDir) &&
    typeof entry.targetDir === 'string' &&
    path.isAbsolute(entry.targetDir) &&
    typeof entry.createdAt === 'string' &&
    typeof entry.noticeDismissed === 'boolean'
  )
}

function writePendingDataDirCleanups(systemDir: string, entries: PendingDataDirCleanup[]): void {
  const filePath = getPendingCleanupsPath(systemDir)
  ensureDir(path.dirname(filePath))
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  const payload: PendingDataDirCleanupFile = { version: 1, entries }

  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
    fs.renameSync(tempPath, filePath)
  } finally {
    if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true })
  }
}

export function getPendingDataDirCleanups(systemDir: string): PendingDataDirCleanup[] {
  const filePath = getPendingCleanupsPath(systemDir)
  if (!fs.existsSync(filePath)) return []

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<PendingDataDirCleanupFile>
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return []
    return parsed.entries.filter(isPendingDataDirCleanup)
  } catch {
    return []
  }
}

export function registerPendingDataDirCleanup(
  systemDir: string,
  input: { sourceDir: string; targetDir: string; createdAt?: string }
): PendingDataDirCleanup | null {
  if (!path.isAbsolute(input.sourceDir) || !path.isAbsolute(input.targetDir)) return null
  if (normalizePathForCompare(input.sourceDir) === normalizePathForCompare(input.targetDir)) return null

  // A directory selected as the new active target is no longer an old backup candidate.
  const entries = getPendingDataDirCleanups(systemDir).filter(
    (entry) => normalizePathForCompare(entry.sourceDir) !== normalizePathForCompare(input.targetDir)
  )
  const existingIndex = entries.findIndex(
    (entry) => normalizePathForCompare(entry.sourceDir) === normalizePathForCompare(input.sourceDir)
  )
  const cleanup: PendingDataDirCleanup = {
    id: existingIndex >= 0 ? entries[existingIndex].id : randomUUID(),
    sourceDir: input.sourceDir,
    targetDir: input.targetDir,
    createdAt: input.createdAt ?? new Date().toISOString(),
    noticeDismissed: false,
  }

  if (existingIndex >= 0) entries.splice(existingIndex, 1, cleanup)
  else entries.push(cleanup)
  writePendingDataDirCleanups(systemDir, entries)
  return cleanup
}

export function dismissPendingDataDirCleanupNotice(systemDir: string, cleanupId: string): boolean {
  const entries = getPendingDataDirCleanups(systemDir)
  const cleanup = entries.find((entry) => entry.id === cleanupId)
  if (!cleanup) return false
  if (cleanup.noticeDismissed) return true

  cleanup.noticeDismissed = true
  writePendingDataDirCleanups(systemDir, entries)
  return true
}

export function deletePendingDataDirCleanup(
  systemDir: string,
  currentDir: string,
  cleanupId: string,
  deps: DeletePendingDataDirCleanupDeps = {}
): { success: boolean; error?: string } {
  const entries = getPendingDataDirCleanups(systemDir)
  const cleanup = entries.find((entry) => entry.id === cleanupId)
  if (!cleanup) return { success: false, error: 'Pending data directory cleanup not found' }

  const sourceDir = cleanup.sourceDir
  const overlapsCurrentDir =
    normalizePathForCompare(sourceDir) === normalizePathForCompare(currentDir) ||
    isSubPath(sourceDir, currentDir) ||
    isSubPath(currentDir, sourceDir)
  const overlapsSystemDir =
    normalizePathForCompare(sourceDir) === normalizePathForCompare(systemDir) || isSubPath(sourceDir, systemDir)

  if (overlapsCurrentDir || overlapsSystemDir) {
    appLogger.warn('data-dir', 'Old data directory cleanup rejected because the path is still in use', { cleanupId })
    return { success: false, error: 'Old data directory overlaps a directory still in use' }
  }
  if (!isPathSafe(sourceDir)) {
    appLogger.warn('data-dir', 'Old data directory cleanup rejected because the path is unsafe', { cleanupId })
    return { success: false, error: 'Old data directory is not safe to delete' }
  }

  try {
    if (fs.existsSync(sourceDir)) {
      if (!isExistingUserDataDir(sourceDir)) {
        appLogger.warn('data-dir', 'Old data directory cleanup rejected because the path is unrecognized', {
          cleanupId,
        })
        return { success: false, error: 'Old data directory is no longer recognized as ChatLab data' }
      }
      const remove = deps.removeDir ?? ((dir: string) => fs.rmSync(dir, { recursive: true, force: true }))
      remove(sourceDir)
    }

    writePendingDataDirCleanups(
      systemDir,
      entries.filter((entry) => entry.id !== cleanupId)
    )
    appLogger.info('data-dir', 'Old data directory cleanup completed by user', { cleanupId })
    return { success: true }
  } catch (error) {
    appLogger.error('data-dir', 'Failed to delete old data directory', error)
    return { success: false, error: 'Failed to delete old data directory' }
  }
}

export function getPendingNodeDataDirMigration(systemDir: string): PendingDataDirMigration | null {
  const filePath = getPendingMigrationPath(systemDir)
  if (!fs.existsSync(filePath)) return null

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as PendingDataDirMigration
    if (!parsed.from || !parsed.to || typeof parsed.migrate !== 'boolean') return null
    return parsed
  } catch {
    return null
  }
}

export function clearPendingNodeDataDirMigration(systemDir: string): void {
  const filePath = getPendingMigrationPath(systemDir)
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }
}

function writePendingNodeDataDirMigration(systemDir: string, pending: PendingDataDirMigration): void {
  const filePath = getPendingMigrationPath(systemDir)
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, JSON.stringify(pending, null, 2), 'utf-8')
}

export function createNodeDataDirSwitch(input: {
  systemDir: string
  currentDir: string
  targetDir: string | null
  defaultDir?: string
  migrate?: boolean
  envDataDir?: string
}): DataDirSwitchResult {
  if (input.envDataDir) {
    return { success: false, error: 'CHATLAB_DATA_DIR is set, data directory cannot be changed from Web UI' }
  }

  const newDir = (input.targetDir?.trim() || input.defaultDir || '').trim()
  if (!newDir) return { success: false, error: 'Data directory is required' }
  if (!path.isAbsolute(newDir)) return { success: false, error: 'Data directory must be an absolute path' }
  if (!isPathSafe(newDir)) return { success: false, error: 'System directories cannot be used as data directory' }

  const migrate = input.migrate !== false
  if (migrate && path.resolve(input.currentDir) !== path.resolve(newDir) && isSubPath(input.currentDir, newDir)) {
    return { success: false, error: 'Target directory cannot be inside current data directory' }
  }

  if (!isUserDataDirSafeToUse(newDir)) {
    return { success: false, error: 'Target directory is not empty and is not a ChatLab data directory' }
  }

  if (path.resolve(input.currentDir) === path.resolve(newDir)) {
    clearPendingNodeDataDirMigration(input.systemDir)
    return { success: true, from: input.currentDir, to: newDir, requiresRelaunch: false }
  }

  const pending = createPendingDataDirMigration({
    from: input.currentDir,
    to: newDir,
    migrate,
    targetWasEmpty: isDirectoryEmptyOrMissing(newDir),
  })
  writePendingNodeDataDirMigration(input.systemDir, pending)

  return { success: true, from: input.currentDir, to: newDir, requiresRelaunch: true }
}

export function applyPendingNodeDataDirMigration(
  systemDir: string,
  deps: ApplyPendingNodeDataDirMigrationDeps = {}
): {
  success: boolean
  skipped?: boolean
  error?: string
} {
  const pending = getPendingNodeDataDirMigration(systemDir)
  if (!pending) return { success: true, skipped: true }
  const writeConfig = deps.writeConfigField ?? writeConfigField

  const result = runPendingDataDirMigration(pending, {
    writeUserDataDir(dir) {
      writeConfig('data', 'user_data_dir', dir)
      writeConfig('data', 'electron_migration_done', true)
    },
    clearPendingMigration() {
      clearPendingNodeDataDirMigration(systemDir)
    },
    recordPendingCleanup(sourceDir, targetDir) {
      registerPendingDataDirCleanup(systemDir, { sourceDir, targetDir })
    },
  })

  if (!result.success) {
    return { success: false, error: result.errors.join('; ') || 'Data directory migration failed' }
  }

  return { success: true }
}
