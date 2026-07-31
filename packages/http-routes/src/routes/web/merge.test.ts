import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Fastify from 'fastify'
import type { PathProvider } from '@openchatlab/core'
import { DatabaseManager, MergeSessionCache, TempDbWriter } from '@openchatlab/node-runtime'
import { registerMergeRoutes } from './merge'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

function makeTempDir(): string {
  const baseDir = process.env.CHATLAB_TEST_TMPDIR ?? (fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir())
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-merge-route-'))
}

function createPathProvider(rootDir: string): PathProvider {
  return {
    getSystemDir: () => rootDir,
    getUserDataDir: () => rootDir,
    getDatabaseDir: () => path.join(rootDir, 'databases'),
    getVectorDir: () => path.join(rootDir, 'vector'),
    getAiDataDir: () => path.join(rootDir, 'ai'),
    getSettingsDir: () => path.join(rootDir, 'settings'),
    getCacheDir: () => path.join(rootDir, 'cache'),
    getTempDir: () => path.join(rootDir, 'temp'),
    getLogsDir: () => path.join(rootDir, 'logs'),
    getDownloadsDir: () => rootDir,
  }
}

test('forwards the session gap threshold when importing merged output', async (t) => {
  const rootDir = makeTempDir()
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }))

  const pathProvider = createPathProvider(rootDir)
  const dbManager = new DatabaseManager(pathProvider, { nativeBinding, allowMissingRuntimeForTests: true })
  const mergeSessionCache = new MergeSessionCache(pathProvider, { nativeBinding })
  const { db, tempDbPath } = mergeSessionCache.createTempDatabase('source.json')
  const writer = new TempDbWriter(db)
  writer.writeMeta({ name: 'Source', platform: 'wechat', type: 'private' })
  writer.writeMembers([{ platformId: 'wxid_alice', accountName: 'Alice' }])
  writer.writeMessages([
    {
      senderPlatformId: 'wxid_alice',
      senderAccountName: 'Alice',
      timestamp: 100,
      type: 0,
      content: 'hello',
    },
  ])
  writer.finish()
  const handle = mergeSessionCache.store('source.json', tempDbPath)

  let receivedOptions: { sessionGapThreshold?: number } | undefined
  const app = Fastify()
  registerMergeRoutes(app, {
    dbManager,
    mergeSessionCache,
    async streamImport(_manager, _filePath, options) {
      receivedOptions = options
      return { sessionId: 'merged-session' }
    },
  })
  await app.ready()
  t.after(() => app.close())

  const response = await app.inject({
    method: 'POST',
    url: '/_web/merge/execute',
    payload: {
      handles: [handle],
      outputName: 'Merged',
      andImport: true,
      sessionGapThreshold: 7200,
    },
  })

  assert.equal(response.statusCode, 200)
  assert.equal(response.json().sessionId, 'merged-session')
  assert.deepEqual(receivedOptions, { sessionGapThreshold: 7200 })
})
