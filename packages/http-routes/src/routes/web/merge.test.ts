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

test('preserves the owner id when exporting existing private sessions for merge', async (t) => {
  const rootDir = makeTempDir()
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }))

  const pathProvider = createPathProvider(rootDir)
  const dbManager = new DatabaseManager(pathProvider, { nativeBinding, allowMissingRuntimeForTests: true })
  const mergeSessionCache = new MergeSessionCache(pathProvider, { nativeBinding })
  const db = dbManager.openRawSessionDatabase('private-session', {
    create: true,
    initializeChatTables: true,
  })
  db.prepare('INSERT INTO meta (name, platform, type, imported_at, owner_id) VALUES (?, ?, ?, ?, ?)').run(
    'Private chat',
    'qq',
    'private',
    1_700_000_000,
    'owner'
  )
  const owner = db.prepare('INSERT INTO member (platform_id, account_name) VALUES (?, ?)').run('owner', 'Owner')
  db.prepare('INSERT INTO member (platform_id, account_name) VALUES (?, ?)').run('peer', 'Peer')
  db.prepare('INSERT INTO message (sender_id, sender_account_name, ts, type, content) VALUES (?, ?, ?, ?, ?)').run(
    owner.lastInsertRowid,
    'Owner',
    1_700_000_001,
    0,
    'hello'
  )
  db.close()

  const app = Fastify()
  registerMergeRoutes(app, { dbManager, mergeSessionCache })
  await app.ready()
  t.after(() => app.close())

  const exportResponse = await app.inject({
    method: 'POST',
    url: '/_web/sessions/export-for-merge',
    payload: { sessionIds: ['private-session'] },
  })
  assert.equal(exportResponse.statusCode, 200)
  const handles = exportResponse.json().handles as Array<{ handle: string }>

  const mergeResponse = await app.inject({
    method: 'POST',
    url: '/_web/merge/execute',
    payload: { handles: handles.map(({ handle }) => handle), outputName: 'Merged private chat' },
  })

  assert.equal(mergeResponse.statusCode, 200)
  assert.equal(mergeResponse.json().data.meta.ownerId, 'owner')
})

test('keeps every distinct platform message when merging a source with its superset', async (t) => {
  const rootDir = makeTempDir()
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }))

  const pathProvider = createPathProvider(rootDir)
  const dbManager = new DatabaseManager(pathProvider, { nativeBinding, allowMissingRuntimeForTests: true })
  const mergeSessionCache = new MergeSessionCache(pathProvider, { nativeBinding })

  const makeMessages = (count: number) =>
    Array.from({ length: count }, (_, index) => {
      const fallbackCollisionIndex = index < 10 ? Math.floor(index / 2) : index
      return {
        platformMessageId: `message-${index}`,
        senderPlatformId: 'qq-user-1',
        senderAccountName: 'Alice',
        timestamp: 1_700_000_000 + fallbackCollisionIndex,
        type: 0 as const,
        content: index < 10 ? `same-second-content-${fallbackCollisionIndex}` : `message-content-${index}`,
        replyToMessageId: index === 11 ? 'message-10' : undefined,
      }
    })

  const createSession = (sessionId: string, messageCount: number): void => {
    const db = dbManager.openRawSessionDatabase(sessionId, { create: true, initializeChatTables: true })
    db.prepare('INSERT INTO meta (name, platform, type, imported_at) VALUES (?, ?, ?, ?)').run(
      'Source',
      'qq',
      'private',
      1_700_000_000
    )
    const memberResult = db
      .prepare('INSERT INTO member (platform_id, account_name) VALUES (?, ?)')
      .run('qq-user-1', 'Alice')
    const insertMessage = db.prepare(
      `INSERT INTO message (
         sender_id, sender_account_name, ts, type, content, platform_message_id, reply_to_message_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    for (const message of makeMessages(messageCount)) {
      insertMessage.run(
        memberResult.lastInsertRowid,
        message.senderAccountName,
        message.timestamp,
        message.type,
        message.content,
        message.platformMessageId,
        message.replyToMessageId || null
      )
    }
    db.close()
  }

  createSession('older', 100)
  createSession('newer', 120)

  const app = Fastify()
  registerMergeRoutes(app, { dbManager, mergeSessionCache })
  await app.ready()
  t.after(() => app.close())

  const exportResponse = await app.inject({
    method: 'POST',
    url: '/_web/sessions/export-for-merge',
    payload: { sessionIds: ['older', 'newer'] },
  })
  assert.equal(exportResponse.statusCode, 200)
  const handles = exportResponse.json().handles as Array<{ handle: string }>

  const conflictResponse = await app.inject({
    method: 'POST',
    url: '/_web/merge/conflicts',
    payload: { handles: handles.map(({ handle }) => handle) },
  })
  assert.equal(conflictResponse.statusCode, 200)
  assert.equal(conflictResponse.json().totalMessages, 120)

  const response = await app.inject({
    method: 'POST',
    url: '/_web/merge/execute',
    payload: {
      handles: handles.map(({ handle }) => handle),
      outputName: 'Merged',
    },
  })

  assert.equal(response.statusCode, 200)
  const messages = response.json().data.messages as Array<{
    platformMessageId?: string
    replyToMessageId?: string
  }>
  assert.equal(messages.length, 120)
  assert.equal(new Set(messages.map((message) => message.platformMessageId)).size, 120)
  assert.equal(messages.find((message) => message.platformMessageId === 'message-11')?.replyToMessageId, 'message-10')
})
