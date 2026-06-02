import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Fastify from 'fastify'
import type { PathProvider } from '@openchatlab/core'
import type { HttpRouteContext } from '../../context'
import { registerCacheRoutes } from './cache'

function createPathProvider(overrides: Partial<PathProvider> = {}): PathProvider {
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
    ...overrides,
  }
}

function makeTempDir(): string {
  const baseDir = fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir()
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-cache-routes-'))
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
      hasLegacyDataAtDefaultDir: false,
      pendingMigration: {
        from: '/tmp/chatlab-test/data',
        to: '/tmp/chatlab-test/new-data',
        createdAt: '2026-06-02T00:00:00.000Z',
      },
    })

    await app.close()
  })

  it('reports legacy data at default directory only when default databases contain db files', async () => {
    const root = makeTempDir()
    const currentDir = path.join(root, 'custom-data')
    const defaultDir = path.join(root, 'default-data')
    fs.mkdirSync(path.join(defaultDir, 'databases'), { recursive: true })
    fs.writeFileSync(path.join(defaultDir, '.chatlab'), 'ChatLab Data Directory')

    const appWithoutDb = Fastify()
    registerCacheRoutes(appWithoutDb, {
      pathProvider: createPathProvider({ getUserDataDir: () => currentDir }),
      defaultUserDataDir: defaultDir,
      isCustomDataDir: true,
    } as unknown as HttpRouteContext)
    await appWithoutDb.ready()

    const emptyResponse = await appWithoutDb.inject({ method: 'GET', url: '/_web/cache/data-dir' })
    assert.equal(emptyResponse.statusCode, 200)
    assert.equal(emptyResponse.json().hasLegacyDataAtDefaultDir, false)
    await appWithoutDb.close()

    fs.writeFileSync(path.join(defaultDir, 'databases', 'legacy.db'), 'sqlite')

    const appWithDb = Fastify()
    registerCacheRoutes(appWithDb, {
      pathProvider: createPathProvider({ getUserDataDir: () => currentDir }),
      defaultUserDataDir: defaultDir,
      isCustomDataDir: true,
    } as unknown as HttpRouteContext)
    await appWithDb.ready()

    const response = await appWithDb.inject({ method: 'GET', url: '/_web/cache/data-dir' })
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().hasLegacyDataAtDefaultDir, true)
    await appWithDb.close()
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
