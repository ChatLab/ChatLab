import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

export const CHATLAB_TEMP_ROOT_ENV = 'CHATLAB_TEMP_ROOT'

const CHATLAB_TEMP_SCOPES = new Set(['tests', 'runtime', 'imports', 'merge', 'sync', 'parser', 'build', 'bench'])

export type ChatLabTempScope = 'tests' | 'runtime' | 'imports' | 'merge' | 'sync' | 'parser' | 'build' | 'bench'

export interface ChatLabTempRootOptions {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  systemTempDir?: string
}

function optionsEnv(options: ChatLabTempRootOptions): NodeJS.ProcessEnv {
  return options.env ?? process.env
}

export function resolveChatLabTempRoot(options: ChatLabTempRootOptions = {}): string {
  const envRoot = optionsEnv(options)[CHATLAB_TEMP_ROOT_ENV]?.trim()
  if (envRoot) return path.resolve(envRoot)

  const platform = options.platform ?? process.platform
  const systemTempDir = options.systemTempDir ?? os.tmpdir()
  return path.resolve(platform === 'darwin' ? '/private/tmp/chatlab' : path.join(systemTempDir, 'chatlab'))
}

function ensurePrivateOwnedDirectory(dirPath: string, label: string): void {
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 })
  const stats = fs.lstatSync(dirPath)
  if (stats.isSymbolicLink()) {
    throw new Error(`${label} must not be a symbolic link: ${dirPath}`)
  }
  if (!stats.isDirectory()) {
    throw new Error(`${label} must be a directory: ${dirPath}`)
  }
  if (typeof process.getuid === 'function' && stats.uid !== process.getuid()) {
    throw new Error(`${label} is owned by another user: ${dirPath}`)
  }
  if (process.platform !== 'win32') {
    fs.chmodSync(dirPath, 0o700)
  }
}

export function ensureChatLabTempRoot(options: ChatLabTempRootOptions = {}): string {
  const root = resolveChatLabTempRoot(options)
  ensurePrivateOwnedDirectory(root, 'ChatLab temp root')
  optionsEnv(options)[CHATLAB_TEMP_ROOT_ENV] = root
  return root
}

function assertValidScope(scope: string): asserts scope is ChatLabTempScope {
  if (!CHATLAB_TEMP_SCOPES.has(scope)) {
    throw new Error(`Invalid ChatLab temp scope: ${scope}`)
  }
}

function assertValidPrefix(prefix: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(prefix)) {
    throw new Error(`Invalid ChatLab temp prefix: ${prefix}`)
  }
}

export function getChatLabTempScopeDir(scope: ChatLabTempScope, options: ChatLabTempRootOptions = {}): string {
  assertValidScope(scope)
  const scopeDir = path.join(ensureChatLabTempRoot(options), scope)
  ensurePrivateOwnedDirectory(scopeDir, 'ChatLab temp scope')
  return scopeDir
}

export function createChatLabTempDir(
  scope: ChatLabTempScope,
  prefix: string,
  options: ChatLabTempRootOptions = {}
): string {
  assertValidPrefix(prefix)
  return fs.mkdtempSync(path.join(getChatLabTempScopeDir(scope, options), prefix))
}

export function removeChatLabTempDir(
  dirPath: string,
  scope: ChatLabTempScope,
  options: ChatLabTempRootOptions = {}
): void {
  const scopeDir = path.resolve(getChatLabTempScopeDir(scope, options))
  const resolvedDir = path.resolve(dirPath)
  if (path.dirname(resolvedDir) !== scopeDir) {
    throw new Error(`Refusing to remove non-owned ChatLab temp directory: ${resolvedDir}`)
  }
  fs.rmSync(resolvedDir, { recursive: true, force: true })
}
