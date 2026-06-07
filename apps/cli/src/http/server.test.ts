import assert from 'node:assert/strict'
import test from 'node:test'
import { DataDirCompatibilityError } from '@openchatlab/node-runtime/src/data-dir-compat'
import { createServer } from './server'

test('createServer returns DATA_DIR_INCOMPATIBLE when a route hits the data directory gate', async () => {
  const server = createServer()
  server.get('/boom', async () => {
    throw new DataDirCompatibilityError(
      'DATA_DIR_REQUIRES_NEWER_RUNTIME',
      'ChatLab data directory requires runtime version 0.25.1 or newer; current version is 0.25.0.',
      {
        userDataDir: '/tmp/chatlab-data',
        metaPath: '/tmp/chatlab-data/.chatlab-meta.json',
        currentVersion: '0.25.0',
        minRuntimeVersion: '0.25.1',
      }
    )
  })

  try {
    const resp = await server.inject({ method: 'GET', url: '/boom' })

    assert.equal(resp.statusCode, 409)
    assert.deepEqual(resp.json(), {
      success: false,
      error: {
        code: 'DATA_DIR_INCOMPATIBLE',
        message: 'ChatLab data directory requires runtime version 0.25.1 or newer; current version is 0.25.0.',
      },
    })
  } finally {
    await server.close()
  }
})
