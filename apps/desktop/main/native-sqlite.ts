/**
 * Desktop better-sqlite3 native binding resolver.
 *
 * The shared node_modules copy of better-sqlite3 always stays on the Node ABI
 * so `pnpm test` works out of the box. When the desktop app runs under
 * Electron in dev, every database open must instead load the Electron-ABI
 * copy at apps/desktop/native/better_sqlite3.node (prepared by
 * scripts/ensure-native.mjs).
 *
 * Windows packaged apps ship the desktop-owned binding at
 * resources/native/better_sqlite3.node and load it explicitly. Other packaged
 * platforms can still fall back to electron-builder's rebuilt node_modules copy.
 *
 * Worker threads cannot compute this reliably from their own __dirname, so the
 * main process resolves once and passes the path through workerData.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

const NATIVE_RELATIVE_PATH = path.join('native', 'better_sqlite3.node')
const MAX_WALK_UP_LEVELS = 5

/**
 * Walk up from startDir looking for native/better_sqlite3.node.
 * Dev bundles live in apps/desktop/out/main[/chunks|/worker], so the binding
 * sits at most a few levels above; the packaged app has no such directory.
 */
export function findDesktopNativeBinding(
  startDir: string,
  exists: (candidate: string) => boolean = fs.existsSync
): string | undefined {
  let dir = startDir
  for (let level = 0; level < MAX_WALK_UP_LEVELS; level++) {
    const candidate = path.join(dir, NATIVE_RELATIVE_PATH)
    if (exists(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

interface ElectronNativeBindingPathOptions {
  startDir: string
  resourcesPath: string
  exists?: (candidate: string) => boolean
}

/**
 * 优先解析成品包 resources/native，其次回退到 dev 工作区 native 目录。
 * 这里只选择 nativeBinding 路径，不加载数据库，也不接触用户数据。
 */
export function resolveElectronNativeBindingPath(options: ElectronNativeBindingPathOptions): string | undefined {
  const exists = options.exists ?? fs.existsSync
  const packagedCandidate = path.join(options.resourcesPath, NATIVE_RELATIVE_PATH)
  if (exists(packagedCandidate)) return packagedCandidate
  return findDesktopNativeBinding(options.startDir, exists)
}

let cachedBinding: string | undefined
let resolved = false

/**
 * Resolve the Electron-ABI better-sqlite3 binding for the current process.
 * Returns undefined under plain Node (tests/tools).
 */
export function resolveDesktopNativeBinding(): string | undefined {
  if (resolved) return cachedBinding
  resolved = true

  if (!process.versions.electron) {
    cachedBinding = undefined
    return cachedBinding
  }

  cachedBinding = resolveElectronNativeBindingPath({
    startDir: __dirname,
    resourcesPath: process.resourcesPath,
  })
  if (!cachedBinding && !__dirname.includes('app.asar')) {
    console.warn(
      '[native-sqlite] Electron-ABI better-sqlite3 binding not found; ' +
        'run `pnpm --filter @openchatlab/desktop ensure-native` or start via `pnpm dev:desktop`.'
    )
  }
  return cachedBinding
}
