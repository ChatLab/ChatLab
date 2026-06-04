import assert from 'node:assert/strict'
import test from 'node:test'

import { createChatlabStartCommand, terminateChatlabStartProcess } from './dev-server-command.mjs'

test('web dev backend runs through the current Node executable with the tsx loader', () => {
  const command = createChatlabStartCommand({
    rootDir: '/repo',
    serverDir: '/repo/apps/cli',
    coreDir: '/repo/packages/core/src',
    runtimeDir: '/repo/packages/node-runtime/src',
    backendPort: 3110,
    nodeExecutable: '/custom/node',
  })

  assert.equal(command.command, '/custom/node')
  assert.deepEqual(command.args, [
    '--watch',
    '--import',
    'tsx',
    'src/cli.ts',
    'start',
    '--headless',
    '--no-open',
    '--port',
    '3110',
  ])
  assert.equal(command.options.detached, true)
})

test('web dev backend cleanup terminates the whole POSIX process group', () => {
  const killed = []
  const proc = {
    pid: 12345,
    exitCode: null,
    signalCode: null,
    kill(signal) {
      killed.push(['child', signal])
      return true
    },
  }

  terminateChatlabStartProcess(proc, {
    platform: 'darwin',
    killProcess: (pid, signal) => {
      killed.push(['process', pid, signal])
      return true
    },
  })

  assert.deepEqual(killed, [['process', -12345, 'SIGTERM']])
})
