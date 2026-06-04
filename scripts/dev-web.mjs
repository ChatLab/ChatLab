#!/usr/bin/env node

/**
 * Cross-platform Web dev launcher.
 *
 * Windows shells do not support inline env syntax such as
 * `CHATLAB_AUTO_SERVE=1 vite ...`, so set the env in Node before spawning Vite.
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
runPnpm(['exec', 'vite', '--config', 'vite.web.config.mts', ...extraArgs], {
  env: {
    ...process.env,
    CHATLAB_AUTO_SERVE: '1',
  },
})
