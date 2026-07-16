import assert from 'node:assert/strict'
import { existsSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import {
  buildNodeTestArgs,
  buildTestEnvironment,
  checkSupportedNodeVersion,
  filterDefaultTestFiles,
  withTestRunTempRoot,
} from './run-tests.mjs'
import { CHATLAB_TEMP_ROOT_ENV } from './chatlab-temp.mjs'

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

test('test run temp root is removed after success and exceptions', () => {
  let successfulRoot = ''
  withTestRunTempRoot((tempRoot) => {
    successfulRoot = tempRoot
    writeFileSync(`${tempRoot}/success.txt`, 'ok')
    assert.equal(existsSync(tempRoot), true)
  })
  assert.equal(existsSync(successfulRoot), false)

  let failedRoot = ''
  assert.throws(
    () =>
      withTestRunTempRoot((tempRoot) => {
        failedRoot = tempRoot
        throw new Error('simulated test runner failure')
      }),
    /simulated test runner failure/
  )
  assert.equal(existsSync(failedRoot), false)
})

test('test subprocesses receive the owned run root as every temp environment entry', () => {
  const env = buildTestEnvironment('/tmp/chatlab/tests/run-example', { KEEP_ME: 'yes' })
  assert.equal(env.TMPDIR, '/tmp/chatlab/tests/run-example')
  assert.equal(env.CHATLAB_TEST_TMPDIR, '/tmp/chatlab/tests/run-example')
  assert.equal(env[CHATLAB_TEMP_ROOT_ENV], '/tmp/chatlab/tests/run-example')
  assert.equal(env.KEEP_ME, 'yes')
})

test('interrupted child exits before its owned test run temp root is removed', () => {
  let tempRoot = ''
  const result = withTestRunTempRoot((root) => {
    tempRoot = root
    return spawnSync(process.execPath, ['-e', "process.kill(process.pid, 'SIGTERM')"], {
      env: buildTestEnvironment(root),
    })
  })

  assert.equal(result.signal, 'SIGTERM')
  assert.equal(existsSync(tempRoot), false)
})

test('parallel test runs receive isolated temp roots and never remove each other', () => {
  let firstRoot = ''
  let secondRoot = ''

  withTestRunTempRoot((rootA) => {
    firstRoot = rootA
    withTestRunTempRoot((rootB) => {
      secondRoot = rootB
      assert.notEqual(rootA, rootB)
      assert.equal(existsSync(rootA), true)
      assert.equal(existsSync(rootB), true)
    })
    assert.equal(existsSync(rootA), true)
    assert.equal(existsSync(secondRoot), false)
  })

  assert.equal(existsSync(firstRoot), false)
  assert.equal(existsSync(secondRoot), false)
})
