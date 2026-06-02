import * as fs from 'fs'
import * as path from 'path'
import { writeConfigField } from '@openchatlab/config'

const CHATLAB_MARKER_FILE = '.chatlab'
const USER_DATA_REQUIRED_DIRS = ['databases']
const PENDING_MIGRATION_FILE = 'data-dir-migration.json'

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
  deleteSourceOnSuccess: boolean
  createdAt: string
}

export interface RunPendingDataDirMigrationDeps {
  copyDirMerge?: typeof copyDirMerge
  ensureDir?: (dirPath: string) => void
  writeUserDataDir: (dir: string) => void
  clearPendingMigration: () => void
  markPendingDeleteDir?: (dir: string) => void
  log?: (message: string) => void
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

export function isExistingUserDataDir(dirPath: string): boolean {
  if (!fs.existsSync(dirPath)) return false

  try {
    return hasChatLabUserDataStructure(fs.readdirSync(dirPath))
  } catch {
    return false
  }
}

export function isUserDataDirSafeToUse(dirPath: string): boolean {
  if (!fs.existsSync(dirPath)) return true

  try {
    const entries = fs.readdirSync(dirPath)
    if (entries.length === 0) return true
    return hasChatLabUserDataStructure(entries)
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
    deleteSourceOnSuccess: input.migrate && input.targetWasEmpty,
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
  deps.clearPendingMigration()

  if (pending.deleteSourceOnSuccess && path.resolve(pending.from) !== path.resolve(pending.to)) {
    deps.markPendingDeleteDir?.(pending.from)
  }

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

// 只删除确认仍是 ChatLab 用户数据目录的旧路径，避免误删用户选择的普通目录。
export function deleteOldUserDataDirIfSafe(
  dirPath: string,
  currentDir: string,
  removeDir?: (dir: string) => void
): boolean {
  if (path.resolve(dirPath) === path.resolve(currentDir)) return false
  if (!isPathSafe(dirPath)) return false
  if (!fs.existsSync(dirPath)) return false
  if (!isExistingUserDataDir(dirPath)) return false

  const remove = removeDir ?? ((dir: string) => fs.rmSync(dir, { recursive: true, force: true }))
  remove(dirPath)
  return true
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
    markPendingDeleteDir(dir) {
      deleteOldUserDataDirIfSafe(dir, pending.to, deps.removeDir)
    },
  })

  if (!result.success) {
    return { success: false, error: result.errors.join('; ') || 'Data directory migration failed' }
  }

  return { success: true }
}
