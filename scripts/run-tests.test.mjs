import assert from 'node:assert/strict'
import test from 'node:test'

import { buildNodeTestArgs, checkSupportedNodeVersion, filterDefaultTestFiles } from './run-tests.mjs'

test('default test collection excludes e2e, smoke, and real external tests', () => {
  const files = [
    'apps/cli/src/ai/chat-command.test.ts',
    'tests/chart-runtime/agent-chart-flow.test.mts',
    'tests/chart-runtime/render-chart.integration.test.ts',
    'tests/e2e/helpers/app-launcher.test.js',
    'tests/e2e/smoke/chart-runtime.smoke.test.js',
    'tests/chart-runtime/real-llm-chart-flow.e2e.test.ts',
    'tests/e2e/helpers/app-launcher.js',
  ]

  assert.deepEqual(filterDefaultTestFiles(files), [
    'apps/cli/src/ai/chat-command.test.ts',
    'tests/chart-runtime/agent-chart-flow.test.mts',
    'tests/chart-runtime/render-chart.integration.test.ts',
  ])
})

test('explicit test arguments are passed through without default exclusions', () => {
  assert.deepEqual(buildNodeTestArgs(['tests/e2e/helpers/app-launcher.test.js']), [
    '--experimental-test-module-mocks',
    '--import',
    'tsx',
    '--test',
    'tests/e2e/helpers/app-launcher.test.js',
  ])
})

test('node version check rejects unsupported test runtimes before native modules load', () => {
  assert.deepEqual(checkSupportedNodeVersion('24.2.0'), { ok: true })
  assert.deepEqual(checkSupportedNodeVersion('22.20.0'), {
    ok: false,
    message:
      'ChatLab tests require Node.js >=24 <25. Current Node.js is 22.20.0. Switch to Node 24 before running tests.',
  })
})
