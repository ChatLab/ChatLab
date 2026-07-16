import assert from 'node:assert/strict'
import test from 'node:test'
import { DataDirCompatibilityError } from '@openchatlab/node-runtime/data-dir-compat'
import { createApiServer } from './server'

test('createApiServer maps shared errors, payload limits, client errors, and unhandled errors consistently', async () => {
  const logged: string[] = []
  const server = createApiServer({
    bodyLimit: 16,
    onUnhandledError: (request, error) => logged.push(`${request.method} ${request.url}: ${error.message}`),
  })
  server.get('/compat', async () => {
    throw new DataDirCompatibilityError('DATA_DIR_REQUIRES_NEWER_RUNTIME', 'Newer runtime required', {
      userDataDir: '/tmp/chatlab-data',
      metaPath: '/tmp/chatlab-data/.chatlab-meta.json',
      currentVersion: '0.31.2',
      minRuntimeVersion: '0.32.0',
    })
  })
  server.post('/body', async () => ({ ok: true }))
  server.get('/client', async () => {
    throw Object.assign(new Error('Bad request'), { statusCode: 400 })
  })
  server.get('/unhandled', async () => {
    throw new Error('Unexpected failure')
  })

  const [compat, body, client, unhandled] = await Promise.all([
    server.inject({ method: 'GET', url: '/compat' }),
    server.inject({ method: 'POST', url: '/body', payload: { value: 'this is too large' } }),
    server.inject({ method: 'GET', url: '/client' }),
    server.inject({ method: 'GET', url: '/unhandled' }),
  ])

  assert.equal(compat.statusCode, 409)
  assert.equal(compat.json().error.code, 'DATA_DIR_INCOMPATIBLE')
  assert.equal(body.statusCode, 413)
  assert.equal(body.json().error.code, 'BODY_TOO_LARGE')
  assert.deepEqual(client.json(), {
    success: false,
    error: { code: 'CLIENT_ERROR', message: 'Bad request' },
  })
  assert.equal(unhandled.statusCode, 500)
  assert.equal(unhandled.json().error.code, 'SERVER_ERROR')
  assert.deepEqual(logged, ['GET /unhandled: Unexpected failure'])

  await server.close()
})
