import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import type { PathProvider } from '@openchatlab/core'
import type { HttpRouteContext } from '../../context'
import { registerCacheRoutes } from './cache'

function createPathProvider(): PathProvider {
  return {
    getSystemDir: () => '/tmp/chatlab-test',
    getUserDataDir: () => '/tmp/chatlab-test/data',
    getDatabaseDir: () => '/tmp/chatlab-test/databases',
    getAiDataDir: () => '/tmp/chatlab-test/ai',
    getSettingsDir: () => '/tmp/chatlab-test/settings',
    getCacheDir: () => '/tmp/chatlab-test/cache',
    getTempDir: () => '/tmp/chatlab-test/temp',
    getLogsDir: () => '/tmp/chatlab-test/logs',
    getDownloadsDir: () => '/tmp/chatlab-test/downloads',
  }
}

describe('registerCacheRoutes data directory routes', () => {
  it('returns data directory capability and pending migration', async () => {
    const app = Fastify()
    const ctx = {
      pathProvider: createPathProvider(),
      defaultUserDataDir: '/tmp/chatlab-test/default-data',
      isCustomDataDir: true,
      canSetDataDir: true,
      getPendingDataDirMigration: () => ({
        from: '/tmp/chatlab-test/data',
        to: '/tmp/chatlab-test/new-data',
        migrate: true,
        createdAt: '2026-06-02T00:00:00.000Z',
      }),
    } as unknown as HttpRouteContext

    registerCacheRoutes(app, ctx)
    await app.ready()

    const response = await app.inject({ method: 'GET', url: '/_web/cache/data-dir' })
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json(), {
      path: '/tmp/chatlab-test/data',
      defaultPath: '/tmp/chatlab-test/default-data',
      isCustom: true,
      canSetDataDir: true,
      pendingMigration: {
        from: '/tmp/chatlab-test/data',
        to: '/tmp/chatlab-test/new-data',
        createdAt: '2026-06-02T00:00:00.000Z',
      },
    })

    await app.close()
  })

  it('delegates data directory changes to context callback', async () => {
    const app = Fastify()
    const calls: Array<{ path: string | null; migrate?: boolean }> = []
    const ctx = {
      pathProvider: createPathProvider(),
      setDataDir: (dirPath: string | null, migrate?: boolean) => {
        calls.push({ path: dirPath, migrate })
        return {
          success: true,
          from: '/tmp/chatlab-test/data',
          to: dirPath ?? '/tmp/chatlab-test/default-data',
          requiresRelaunch: true,
        }
      },
    } as unknown as HttpRouteContext

    registerCacheRoutes(app, ctx)
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/_web/cache/data-dir',
      payload: { path: '/tmp/chatlab-test/new-data', migrate: true },
    })

    assert.equal(response.statusCode, 200)
    assert.deepEqual(calls, [{ path: '/tmp/chatlab-test/new-data', migrate: true }])
    assert.deepEqual(response.json(), {
      success: true,
      from: '/tmp/chatlab-test/data',
      to: '/tmp/chatlab-test/new-data',
      requiresRelaunch: true,
    })

    await app.close()
  })

  it('returns 501 when data directory changes are unsupported', async () => {
    const app = Fastify()
    registerCacheRoutes(app, { pathProvider: createPathProvider() } as unknown as HttpRouteContext)
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/_web/cache/data-dir',
      payload: { path: '/tmp/chatlab-test/new-data', migrate: true },
    })

    assert.equal(response.statusCode, 501)
    assert.deepEqual(response.json(), {
      success: false,
      error: 'Data directory changes are not supported',
    })

    await app.close()
  })
})
