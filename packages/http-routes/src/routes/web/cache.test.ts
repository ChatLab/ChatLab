import { after, describe, it, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Fastify from 'fastify'
import type { PathProvider } from '@openchatlab/core'
import { registerCacheRoutes } from './cache'

type CacheRouteContext = Parameters<typeof registerCacheRoutes>[1]

const testSystemDir = fs.mkdtempSync(
  path.join(process.env.CHATLAB_TEST_TMPDIR ?? os.tmpdir(), 'chatlab-cache-routes-suite-')
)
const testUserDataDir = path.join(testSystemDir, 'data')
const testDefaultDataDir = path.join(testSystemDir, 'default-data')
const testNewDataDir = path.join(testSystemDir, 'new-data')

after(() => fs.rmSync(testSystemDir, { recursive: true, force: true }))

function createPathProvider(overrides: Partial<PathProvider> = {}): PathProvider {
  return {
    getSystemDir: () => testSystemDir,
    getUserDataDir: () => testUserDataDir,
    getDatabaseDir: () => path.join(testSystemDir, 'databases'),
    getVectorDir: () => path.join(testSystemDir, 'vector'),
    getAiDataDir: () => path.join(testSystemDir, 'ai'),
    getSettingsDir: () => path.join(testSystemDir, 'settings'),
    getCacheDir: () => path.join(testSystemDir, 'cache'),
    getTempDir: () => path.join(testSystemDir, 'temp'),
    getLogsDir: () => path.join(testSystemDir, 'logs'),
    getDownloadsDir: () => path.join(testSystemDir, 'downloads'),
    ...overrides,
  }
}

function makeTempDir(t: TestContext): string {
  const baseDir = process.env.CHATLAB_TEST_TMPDIR ?? (fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir())
  const dir = fs.mkdtempSync(path.join(baseDir, 'chatlab-cache-routes-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

describe('registerCacheRoutes data directory routes', () => {
  it('marks storage directories by canonical scope', async () => {
    const app = Fastify()
    registerCacheRoutes(app, { pathProvider: createPathProvider() })
    await app.ready()

    const response = await app.inject({ method: 'GET', url: '/_web/cache/info' })
    assert.equal(response.statusCode, 200)
    assert.deepEqual(
      response.json().directories.map((dir: { id: string; scope: string; rootPath: string }) => ({
        id: dir.id,
        scope: dir.scope,
        rootPath: dir.rootPath,
      })),
      [
        { id: 'databases', scope: 'user-data', rootPath: testUserDataDir },
        { id: 'ai', scope: 'system-data', rootPath: testSystemDir },
        { id: 'cache', scope: 'system-data', rootPath: testSystemDir },
        { id: 'logs', scope: 'system-data', rootPath: testSystemDir },
      ]
    )

    await app.close()
  })

  it('opens the storage root and chat data directory separately', async () => {
    const app = Fastify()
    const openedDirs: string[] = []
    const ctx: CacheRouteContext = {
      pathProvider: createPathProvider(),
      openDirectory: async (dirPath: string) => {
        openedDirs.push(dirPath)
      },
    }
    registerCacheRoutes(app, ctx)
    await app.ready()

    const infoResponse = await app.inject({ method: 'GET', url: '/_web/cache/info' })
    assert.equal(infoResponse.statusCode, 200)
    assert.equal(infoResponse.json().baseDir, testSystemDir)

    const baseResponse = await app.inject({
      method: 'POST',
      url: '/_web/cache/open-dir',
      payload: { cacheId: 'base' },
    })
    assert.equal(baseResponse.statusCode, 200)

    const userDataResponse = await app.inject({
      method: 'POST',
      url: '/_web/cache/open-dir',
      payload: { cacheId: 'userData' },
    })
    assert.equal(userDataResponse.statusCode, 200)
    assert.deepEqual(openedDirs, [testSystemDir, testUserDataDir])

    await app.close()
  })

  it('returns data directory capability and pending migration', async () => {
    const app = Fastify()
    const ctx: CacheRouteContext = {
      pathProvider: createPathProvider(),
      defaultUserDataDir: testDefaultDataDir,
      isCustomDataDir: true,
      canSetDataDir: true,
      getPendingDataDirMigration: () => ({
        from: testUserDataDir,
        to: testNewDataDir,
        migrate: true,
        deleteSourceOnSuccess: false,
        createdAt: '2026-06-02T00:00:00.000Z',
      }),
    }

    registerCacheRoutes(app, ctx)
    await app.ready()

    const response = await app.inject({ method: 'GET', url: '/_web/cache/data-dir' })
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json(), {
      path: testUserDataDir,
      defaultPath: testDefaultDataDir,
      isCustom: true,
      canSetDataDir: true,
      managedScope: 'chat-databases',
      managedDescription: 'settings.storage.dataLocation.managedDescription',
      hasLegacyDataAtDefaultDir: false,
      pendingMigration: {
        from: testUserDataDir,
        to: testNewDataDir,
        createdAt: '2026-06-02T00:00:00.000Z',
      },
    })

    await app.close()
  })

  it('reports legacy data at default directory only when default databases contain db files', async (t) => {
    const root = makeTempDir(t)
    const currentDir = path.join(root, 'custom-data')
    const defaultDir = path.join(root, 'default-data')
    fs.mkdirSync(path.join(defaultDir, 'databases'), { recursive: true })
    fs.writeFileSync(path.join(defaultDir, '.chatlab'), 'ChatLab Data Directory')

    const appWithoutDb = Fastify()
    registerCacheRoutes(appWithoutDb, {
      pathProvider: createPathProvider({ getUserDataDir: () => currentDir }),
      defaultUserDataDir: defaultDir,
      isCustomDataDir: true,
    })
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
    })
    await appWithDb.ready()

    const response = await appWithDb.inject({ method: 'GET', url: '/_web/cache/data-dir' })
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().hasLegacyDataAtDefaultDir, true)
    await appWithDb.close()
  })

  it('delegates data directory changes to context callback', async () => {
    const app = Fastify()
    const calls: Array<{ path: string | null; migrate?: boolean }> = []
    const ctx: CacheRouteContext = {
      pathProvider: createPathProvider(),
      setDataDir: (dirPath: string | null, migrate?: boolean) => {
        calls.push({ path: dirPath, migrate })
        return {
          success: true,
          from: testUserDataDir,
          to: dirPath ?? testDefaultDataDir,
          requiresRelaunch: true,
        }
      },
    }

    registerCacheRoutes(app, ctx)
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/_web/cache/data-dir',
      payload: { path: testNewDataDir, migrate: true },
    })

    assert.equal(response.statusCode, 200)
    assert.deepEqual(calls, [{ path: testNewDataDir, migrate: true }])
    assert.deepEqual(response.json(), {
      success: true,
      from: testUserDataDir,
      to: testNewDataDir,
      requiresRelaunch: true,
    })

    await app.close()
  })

  it('returns 501 when data directory changes are unsupported', async () => {
    const app = Fastify()
    registerCacheRoutes(app, { pathProvider: createPathProvider() })
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/_web/cache/data-dir',
      payload: { path: testNewDataDir, migrate: true },
    })

    assert.equal(response.statusCode, 501)
    assert.deepEqual(response.json(), {
      success: false,
      error: 'Data directory changes are not supported',
    })

    await app.close()
  })
})
