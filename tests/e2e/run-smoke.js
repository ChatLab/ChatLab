'use strict'

const { spawnSync } = require('node:child_process')
const path = require('node:path')

const testRunner = path.resolve(__dirname, '../../scripts/run-tests.mjs')

const result = spawnSync(
  process.execPath,
  [testRunner, 'tests/e2e/smoke/app-launcher.smoke.test.js', 'tests/e2e/smoke/chart-runtime.smoke.test.js'],
  {
    stdio: 'inherit',
    env: { ...process.env, CHATLAB_RUN_E2E_SMOKE: '1' },
  }
)

if (typeof result.status === 'number') {
  process.exit(result.status)
}

process.exit(1)
