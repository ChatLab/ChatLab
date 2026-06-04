'use strict'

const { spawnSync } = require('node:child_process')

process.env.CHATLAB_RUN_E2E_SMOKE = '1'

const result = spawnSync(
  process.execPath,
  ['--test', 'tests/e2e/smoke/app-launcher.smoke.test.js', 'tests/e2e/smoke/chart-runtime.smoke.test.js'],
  {
    stdio: 'inherit',
    env: process.env,
  }
)

if (typeof result.status === 'number') {
  process.exit(result.status)
}

process.exit(1)
