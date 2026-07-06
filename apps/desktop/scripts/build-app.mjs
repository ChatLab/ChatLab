#!/usr/bin/env node
/**
 * Run electron-builder, then always restore the shared better-sqlite3 binding
 * to the Node ABI — even when packaging fails — so a local `pnpm build:mac` /
 * `pnpm build:win` never leaves `pnpm test` broken.
 *
 * Usage: node scripts/build-app.mjs --mac [extra electron-builder args]
 */

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { restoreNodeAbi } from './restore-node-abi.mjs'

const desktopDir = dirname(dirname(fileURLToPath(import.meta.url)))
const builderArgs = [...process.argv.slice(2), '--config', 'electron-builder.yml', '-p', 'never']

const result = spawnSync('pnpm', ['exec', 'electron-builder', ...builderArgs], {
  cwd: desktopDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

const restored = restoreNodeAbi()
const builderExitCode = result.status ?? 1

if (builderExitCode !== 0) process.exit(builderExitCode)
if (!restored) process.exit(1)

console.error(`[desktop build] packaged app written to ${resolve(desktopDir, 'dist')}`)
