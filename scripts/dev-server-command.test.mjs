import assert from 'node:assert/strict'
import test from 'node:test'

import { createChatlabServeCommand } from './dev-server-command.mjs'

test('web dev backend runs through the current Node executable with the tsx loader', () => {
  const command = createChatlabServeCommand({
    rootDir: '/repo',
    serverDir: '/repo/apps/cli',
    coreDir: '/repo/packages/core/src',
    runtimeDir: '/repo/packages/node-runtime/src',
    backendPort: 3110,
    nodeExecutable: '/custom/node',
  })

  assert.equal(command.command, '/custom/node')
  assert.deepEqual(command.args, ['--watch', '--import', 'tsx', 'src/cli.ts', 'serve', '--port', '3110'])
})
