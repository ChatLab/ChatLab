#!/usr/bin/env node
/**
 * Restore the shared node_modules better-sqlite3 binding to the Node ABI.
 *
 * electron-builder (npmRebuild: true) rebuilds better-sqlite3 in place for
 * Electron while packaging, which would break `pnpm test` afterwards. This
 * script verifies the shared binding still loads under the current Node and,
 * if not, re-runs the package install script (prebuild-install) to bring the
 * Node prebuilt back.
 */

import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const currentFile = fileURLToPath(import.meta.url)
const desktopDir = dirname(dirname(currentFile))
const desktopRequire = createRequire(join(desktopDir, 'package.json'))

function log(message) {
  console.error(`[desktop native] ${message}`)
}

function getNodeAbiStatus(bindingPath) {
  const result = spawnSync(
    process.execPath,
    ['-e', 'require(process.argv[1]); process.stdout.write(process.versions.modules)', bindingPath],
    { encoding: 'utf8' }
  )
  if (result.status === 0) return { ok: true, abi: result.stdout.trim() }
  return { ok: false, message: (result.stderr || result.stdout || 'binding failed to load').trim() }
}

export function restoreNodeAbi() {
  const pkgDir = dirname(desktopRequire.resolve('better-sqlite3/package.json'))
  const bindingPath = join(pkgDir, 'build', 'Release', 'better_sqlite3.node')

  const before = getNodeAbiStatus(bindingPath)
  if (before.ok) {
    log(`shared better-sqlite3 already on Node ABI ${before.abi}; nothing to restore`)
    return true
  }

  log('shared better-sqlite3 was rebuilt for Electron by electron-builder; restoring Node ABI...')
  const rebuild = spawnSync('npm', ['rebuild', 'better-sqlite3'], {
    cwd: desktopDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (rebuild.status !== 0) {
    log('npm rebuild better-sqlite3 failed; run it manually before `pnpm test`')
    return false
  }

  const after = getNodeAbiStatus(bindingPath)
  if (!after.ok) {
    log(`restore finished but binding still unusable under Node: ${after.message}`)
    return false
  }

  log(`shared better-sqlite3 restored to Node ABI ${after.abi}`)
  return true
}

if (process.argv[1] && currentFile === resolve(process.argv[1])) {
  process.exit(restoreNodeAbi() ? 0 : 1)
}
