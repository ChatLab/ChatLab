import * as fs from 'fs'
import * as path from 'path'

// 系统关键目录列表（用于安全校验）
const DANGEROUS_PATHS = [
  // Windows 系统目录
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\ProgramData',
  // Unix 系统目录
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

// 统一路径标准化（兼容 Windows 大小写差异）
function normalizePathForCompare(input: string): string {
  const resolved = path.resolve(input)
  const normalized = path.normalize(resolved)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/**
 * 判断 child 是否为 parent 的子目录
 */
export function isSubPath(parent: string, child: string): boolean {
  const parentPath = normalizePathForCompare(parent)
  const childPath = normalizePathForCompare(child)

  if (parentPath === childPath) return false
  return childPath.startsWith(`${parentPath}${path.sep}`)
}

/**
 * 检查路径是否安全（不在系统关键目录下）
 */
export function isPathSafe(targetPath: string): boolean {
  const normalizedTarget = targetPath.toLowerCase().replace(/\//g, '\\')

  for (const dangerous of DANGEROUS_PATHS) {
    const normalizedDangerous = dangerous.toLowerCase().replace(/\//g, '\\')
    if (normalizedTarget.startsWith(normalizedDangerous)) {
      return false
    }
  }

  return true
}

/**
 * 检查目录是否为空或包含 ChatLab 标记与关键结构
 */
export function isDirectorySafeToUse(dirPath: string, markerFile: string, requiredDirs: string[]): boolean {
  if (!fs.existsSync(dirPath)) {
    return true // 目录不存在，可以安全使用
  }

  try {
    const entries = fs.readdirSync(dirPath)
    // 如果目录为空，可以安全使用
    if (entries.length === 0) return true

    return hasChatLabStructure(entries, markerFile, requiredDirs)
  } catch {
    return false
  }
}

/**
 * 检查目录是否为已存在的 ChatLab 数据目录
 */
export function isExistingChatLabDir(dirPath: string, markerFile: string, requiredDirs: string[]): boolean {
  if (!fs.existsSync(dirPath)) return false

  try {
    const entries = fs.readdirSync(dirPath)
    return hasChatLabStructure(entries, markerFile, requiredDirs)
  } catch {
    return false
  }
}

/**
 * 确保数据目录标记文件存在
 */
export function ensureMarkerFile(dirPath: string, markerFile: string): void {
  try {
    const markerPath = path.join(dirPath, markerFile)
    if (!fs.existsSync(markerPath)) {
      fs.writeFileSync(markerPath, 'ChatLab Data Directory', 'utf-8')
    }
  } catch {
    // 标记文件写入失败时静默处理
  }
}

/**
 * 递归复制目录
 */
export function copyDirRecursive(src: string, dest: string, ensureDir: (dirPath: string) => void): void {
  ensureDir(dest)
  const entries = fs.readdirSync(src, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath, ensureDir)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

export interface CopyStats {
  copied: number
  skipped: number
  errors: string[]
}

/**
 * 递归合并复制目录（仅复制目标不存在的文件）
 * @returns 复制结果统计
 */
export function copyDirMerge(
  src: string,
  dest: string,
  ensureDir: (dirPath: string) => void,
  stats: CopyStats = { copied: 0, skipped: 0, errors: [] }
): CopyStats {
  if (!fs.existsSync(src)) return stats

  try {
    ensureDir(dest)
    const entries = fs.readdirSync(src, { withFileTypes: true })

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name)
      const destPath = path.join(dest, entry.name)

      try {
        if (entry.isDirectory()) {
          if (!fs.existsSync(destPath)) {
            copyDirRecursive(srcPath, destPath, ensureDir)
            stats.copied++
          } else {
            copyDirMerge(srcPath, destPath, ensureDir, stats)
          }
        } else {
          if (!fs.existsSync(destPath)) {
            fs.copyFileSync(srcPath, destPath)
            stats.copied++
          } else {
            stats.skipped++
          }
        }
      } catch (error) {
        const errorMsg = `复制失败: ${srcPath} -> ${error instanceof Error ? error.message : String(error)}`
        console.error('[Paths]', errorMsg)
        stats.errors.push(errorMsg)
      }
    }
  } catch (error) {
    const errorMsg = `读取目录失败: ${src} -> ${error instanceof Error ? error.message : String(error)}`
    console.error('[Paths]', errorMsg)
    stats.errors.push(errorMsg)
  }

  return stats
}

/**
 * 写入迁移日志到 app.log
 */
export function writeMigrationLog(logDir: string, message: string, ensureDir: (dirPath: string) => void): void {
  try {
    ensureDir(logDir)
    const logPath = path.join(logDir, 'app.log')
    const now = new Date()
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
    const logLine = `[${timestamp}] [MIGRATION] ${message}\n`
    fs.appendFileSync(logPath, logLine, 'utf-8')
  } catch {
    // 日志写入失败时静默处理
  }
}

function hasChatLabStructure(entries: string[], markerFile: string, requiredDirs: string[]): boolean {
  const hasMarker = entries.includes(markerFile)
  const hasRequiredDirs = requiredDirs.every((dir) => entries.includes(dir))
  return hasMarker && hasRequiredDirs
}
