import * as fs from 'fs'
import * as path from 'path'
import { copyDirMerge, type CopyStats } from './pathUtils'

const CHATLAB_MARKER_FILE = '.chatlab'
const USER_DATA_REQUIRED_DIRS = ['databases']

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
