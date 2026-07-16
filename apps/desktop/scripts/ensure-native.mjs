#!/usr/bin/env node
/**
 * Ensure apps/desktop/native/better_sqlite3.node is a valid Electron-ABI binding.
 *
 * The shared node_modules copy of better-sqlite3 stays on the Node ABI
 * (so `pnpm test` always works); Electron dev loads this desktop-owned copy
 * instead via the nativeBinding option (see main/native-sqlite.ts).
 *
 * Verification runs the Electron binary with ELECTRON_RUN_AS_NODE so the
 * check uses the real Electron ABI. Rebuild downloads the matching Electron
 * prebuilt into an isolated temp dir (never touching shared node_modules),
 * falling back to a node-gyp source build against Electron headers.
 */

import { createRequire } from 'node:module'
import { existsSync, mkdirSync, rmSync, copyFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createChatLabTempDir } from '../../../scripts/chatlab-temp.mjs'

const currentFile = fileURLToPath(import.meta.url)
const desktopDir = dirname(dirname(currentFile))
const nativePath = resolve(desktopDir, 'native/better_sqlite3.node')
const desktopRequire = createRequire(join(desktopDir, 'package.json'))
const useShell = process.platform === 'win32'

function log(message) {
  console.error(`[desktop native] ${message}`)
}

function resolveElectron() {
  // Under plain Node, require('electron') returns the path to the Electron binary.
  const binaryPath = desktopRequire('electron')
  const version = desktopRequire('electron/package.json').version
  return { binaryPath, version }
}

export function getElectronNativeStatus(bindingPath, electronBinaryPath) {
  if (!existsSync(bindingPath)) {
    return { ok: false, reason: 'missing', message: `Native binding not found: ${bindingPath}` }
  }

  const result = spawnSync(
    electronBinaryPath,
    ['-e', 'require(process.argv[1]); process.stdout.write(process.versions.modules)', bindingPath],
    { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }
  )

  if (result.status === 0) {
    return { ok: true, reason: 'valid', abi: result.stdout.trim() }
  }

  return {
    ok: false,
    reason: 'invalid',
    message: (result.stderr || result.stdout || result.error?.message || 'Native binding failed to load').trim(),
  }
}

function run(command, args, options) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: useShell, ...options })
  return result.status === 0
}

function rebuild(electronVersion) {
  const sqliteVersion = desktopRequire('better-sqlite3/package.json').version
  log(`Fetching better-sqlite3@${sqliteVersion} for Electron ${electronVersion}...`)

  const tempDir = createChatLabTempDir('build', 'desktop-native-')
  try {
    const installOk = run(
      'npm',
      ['install', `better-sqlite3@${sqliteVersion}`, '--ignore-scripts', '--no-audit', '--no-fund'],
      { cwd: tempDir }
    )
    if (!installOk) {
      log('Failed to stage better-sqlite3 sources in temp dir')
      return false
    }

    const pkgDir = join(tempDir, 'node_modules', 'better-sqlite3')
    const prebuiltOk = run('npx', ['--yes', 'prebuild-install', '-r', 'electron', '-t', electronVersion], {
      cwd: pkgDir,
    })
    if (!prebuiltOk) {
      log('Electron prebuilt unavailable; compiling from source (requires build toolchain)...')
      const gypOk = run(
        'npx',
        [
          '--yes',
          'node-gyp',
          'rebuild',
          '--release',
          `--runtime=electron`,
          `--target=${electronVersion}`,
          '--dist-url=https://electronjs.org/headers',
        ],
        { cwd: pkgDir }
      )
      if (!gypOk) return false
    }

    const built = join(pkgDir, 'build', 'Release', 'better_sqlite3.node')
    if (!existsSync(built)) {
      log(`Build finished but binary not found at ${built}`)
      return false
    }

    mkdirSync(dirname(nativePath), { recursive: true })
    copyFileSync(built, nativePath)
    return true
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

function main() {
  const checkOnly = process.argv.includes('--check')
  const electron = resolveElectron()
  const status = getElectronNativeStatus(nativePath, electron.binaryPath)

  if (status.ok) {
    log(`better-sqlite3 ready (Electron ABI ${status.abi})`)
    return
  }

  if (checkOnly) {
    log(status.message)
    process.exit(1)
  }

  log(status.message)
  if (!rebuild(electron.version)) {
    log('Failed to prepare the Electron native binding')
    process.exit(1)
  }

  const rebuilt = getElectronNativeStatus(nativePath, electron.binaryPath)
  if (!rebuilt.ok) {
    log(`Rebuild completed, but native binding is still unusable: ${rebuilt.message}`)
    process.exit(1)
  }

  log(`better-sqlite3 ready (Electron ABI ${rebuilt.abi})`)
}

if (process.argv[1] && currentFile === resolve(process.argv[1])) {
  main()
}
