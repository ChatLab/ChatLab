#!/usr/bin/env node

/**
 * Cross-platform API server dev launcher.
 */

import { spawnSync } from 'node:child_process'

const pnpm = 'pnpm'
const extraArgs = process.argv.slice(2)

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
    ...options,
  })
  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function runPnpm(args, options = {}) {
  if (process.env.npm_execpath) {
    run(process.execPath, [process.env.npm_execpath, ...args], options)
    return
  }
  run(pnpm, args, { shell: process.platform === 'win32', ...options })
}

runPnpm(['run', 'ensure:server-native'])
runPnpm([
  'exec',
  'tsx',
  'watch',
  '--include',
  'packages/core/src/**',
  '--include',
  'packages/node-runtime/src/**',
  'apps/cli/src/cli.ts',
  'start',
  '--headless',
  '--no-open',
  ...extraArgs,
])
