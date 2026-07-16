import { chmodSync, lstatSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export const CHATLAB_TEMP_ROOT_ENV = 'CHATLAB_TEMP_ROOT'

const CHATLAB_TEMP_SCOPES = new Set(['tests', 'runtime', 'imports', 'merge', 'sync', 'parser', 'build', 'bench'])

export function resolveChatLabTempRoot(env = process.env) {
  const configured = env[CHATLAB_TEMP_ROOT_ENV]?.trim()
  if (configured) return resolve(configured)
  return resolve(process.platform === 'darwin' ? '/private/tmp/chatlab' : join(tmpdir(), 'chatlab'))
}

function ensurePrivateDirectory(dirPath) {
  mkdirSync(dirPath, { recursive: true, mode: 0o700 })
  const stats = lstatSync(dirPath)
  if (stats.isSymbolicLink()) throw new Error(`ChatLab temp directory must not be a symbolic link: ${dirPath}`)
  if (!stats.isDirectory()) throw new Error(`ChatLab temp path must be a directory: ${dirPath}`)
  if (typeof process.getuid === 'function' && stats.uid !== process.getuid()) {
    throw new Error(`ChatLab temp directory is owned by another user: ${dirPath}`)
  }
  if (process.platform !== 'win32') chmodSync(dirPath, 0o700)
}

export function getChatLabTempScopeDir(scope, env = process.env) {
  if (!CHATLAB_TEMP_SCOPES.has(scope)) throw new Error(`Invalid ChatLab temp scope: ${scope}`)
  const root = resolveChatLabTempRoot(env)
  ensurePrivateDirectory(root)
  env[CHATLAB_TEMP_ROOT_ENV] = root
  const scopeDir = join(root, scope)
  ensurePrivateDirectory(scopeDir)
  return scopeDir
}

export function createChatLabTempDir(scope, prefix, env = process.env) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(prefix)) throw new Error(`Invalid ChatLab temp prefix: ${prefix}`)
  return mkdtempSync(join(getChatLabTempScopeDir(scope, env), prefix))
}
