import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { CHAT_DB_SCHEMA } from '@openchatlab/core'
import { openBetterSqliteDatabase } from '../better-sqlite3-adapter'
import { analyzeIncrementalImport, incrementalImport, type IncrementalImportDeps } from './incremental-importer'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

function makeTempDir(): string {
  const baseDir = fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir()
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-incremental-import-'))
}

function writeChatLabJsonl(filePath: string): void {
  const lines = [
    {
      _type: 'header',
      chatlab: { version: '0.0.2', exportedAt: 1780330900 },
      meta: { name: 'CipherTalk Export', platform: 'wechat', type: 'private' },
    },
    {
      _type: 'member',
      platformId: 'wxid_alice',
      accountName: 'Alice',
    },
    {
      _type: 'message',
      sender: 'wxid_alice',
      accountName: 'Alice',
      timestamp: '1780330832',
      type: 0,
      content: 'hello from CipherTalk',
    },
  ]

  fs.writeFileSync(filePath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8')
}

function writeChatLabJson(filePath: string): void {
  fs.writeFileSync(
    filePath,
    JSON.stringify({
      chatlab: { version: '0.0.2', exportedAt: 1780330900 },
      meta: { name: 'ChatLab Export', platform: 'wechat', type: 'private' },
      members: [{ platformId: 'wxid_alice', accountName: 'Alice', aliases: ['Ally'] }],
      messages: [
        {
          sender: 'wxid_alice',
          accountName: 'Alice',
          timestamp: 1780330832,
          type: 0,
          content: 'hello from ChatLab',
        },
      ],
    }),
    'utf8'
  )
}

function seedSessionDb(dbPath: string): void {
  const db = openBetterSqliteDatabase(dbPath, { nativeBinding })
  db.exec(CHAT_DB_SCHEMA)
  db.prepare(
    `INSERT INTO meta (name, platform, type, imported_at, schema_version)
     VALUES (?, ?, ?, ?, ?)`
  ).run('Existing Session', 'wechat', 'private', 1780330000, 6)
  db.close()
}

function createDeps(dbPath: string): IncrementalImportDeps {
  return {
    openDatabase: (_sessionId, readonly = false) => openBetterSqliteDatabase(dbPath, { readonly, nativeBinding }),
    onProgress: () => {},
  }
}

test('imports ChatLab JSONL messages with numeric string timestamps consistently with analysis', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const dbPath = path.join(tempDir, 'session.db')
  const filePath = path.join(tempDir, 'cipher-talk.jsonl')
  seedSessionDb(dbPath)
  writeChatLabJsonl(filePath)

  const deps = createDeps(dbPath)

  const analysis = await analyzeIncrementalImport('session', filePath, deps)
  assert.deepEqual(analysis, {
    newMessageCount: 1,
    duplicateCount: 0,
    totalInFile: 1,
  })

  const result = await incrementalImport('session', filePath, deps)
  assert.equal(result.success, true)
  assert.equal(result.newMessageCount, 1)
  assert.equal(result.batch?.writtenCount, 1)
  assert.equal(result.batch?.errorCount, 0)

  const db = openBetterSqliteDatabase(dbPath, { readonly: true, nativeBinding })
  const row = db.prepare('SELECT ts, content FROM message').get() as { ts: number; content: string } | undefined
  db.close()

  assert.deepEqual(row, {
    ts: 1780330832,
    content: 'hello from CipherTalk',
  })
})

test('preserves ChatLab JSON member aliases during incremental import', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const dbPath = path.join(tempDir, 'session.db')
  const filePath = path.join(tempDir, 'chatlab.json')
  seedSessionDb(dbPath)
  writeChatLabJson(filePath)

  const result = await incrementalImport('session', filePath, createDeps(dbPath))
  assert.equal(result.success, true)

  const db = openBetterSqliteDatabase(dbPath, { readonly: true, nativeBinding })
  const row = db.prepare("SELECT aliases FROM member WHERE platform_id = 'wxid_alice'").get() as
    | { aliases: string }
    | undefined
  db.close()

  assert.deepEqual(JSON.parse(row?.aliases ?? '[]'), ['Ally'])
})

test('does not deduplicate messages that only share timestamp, sender and content', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const dbPath = path.join(tempDir, 'session.db')
  const filePath = path.join(tempDir, 'different-type.json')
  seedSessionDb(dbPath)

  const db = openBetterSqliteDatabase(dbPath, { nativeBinding })
  db.prepare('INSERT INTO member (platform_id, account_name) VALUES (?, ?)').run('wxid_alice', 'Alice')
  const member = db.prepare('SELECT id FROM member WHERE platform_id = ?').get('wxid_alice') as { id: number }
  db.prepare('INSERT INTO message (sender_id, ts, type, content) VALUES (?, ?, ?, ?)').run(
    member.id,
    1780330832,
    0,
    'same content'
  )
  db.close()

  fs.writeFileSync(
    filePath,
    JSON.stringify({
      chatlab: { version: '0.0.2', exportedAt: 1780330900 },
      meta: { name: 'Different Type', platform: 'wechat', type: 'private' },
      members: [{ platformId: 'wxid_alice', accountName: 'Alice' }],
      messages: [
        {
          sender: 'wxid_alice',
          accountName: 'Alice',
          timestamp: 1780330832,
          type: 1,
          content: 'same content',
        },
      ],
    }),
    'utf8'
  )

  const result = await incrementalImport('session', filePath, createDeps(dbPath))

  assert.equal(result.success, true)
  assert.equal(result.newMessageCount, 1)
  assert.equal(result.batch?.duplicateCount, 0)
})

test('deduplicates an ID-bearing copy of an existing fallback-only message', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const dbPath = path.join(tempDir, 'session.db')
  const filePath = path.join(tempDir, 'mixed-id.json')
  seedSessionDb(dbPath)

  const db = openBetterSqliteDatabase(dbPath, { nativeBinding })
  db.prepare('INSERT INTO member (platform_id, account_name) VALUES (?, ?)').run('wxid_alice', 'Alice')
  const member = db.prepare('SELECT id FROM member WHERE platform_id = ?').get('wxid_alice') as { id: number }
  db.prepare('INSERT INTO message (sender_id, ts, type, content) VALUES (?, ?, ?, ?)').run(
    member.id,
    1780330832,
    0,
    'same message'
  )
  db.close()

  fs.writeFileSync(
    filePath,
    JSON.stringify({
      chatlab: { version: '0.0.2', exportedAt: 1780330900 },
      meta: { name: 'Mixed ID', platform: 'wechat', type: 'private' },
      members: [{ platformId: 'wxid_alice', accountName: 'Alice' }],
      messages: [
        {
          sender: 'wxid_alice',
          accountName: 'Alice',
          timestamp: 1780330832,
          type: 0,
          content: 'same message',
          platformMessageId: 'msg-1',
        },
      ],
    }),
    'utf8'
  )

  const deps = createDeps(dbPath)
  assert.deepEqual(await analyzeIncrementalImport('session', filePath, deps), {
    newMessageCount: 0,
    duplicateCount: 1,
    totalInFile: 1,
  })

  const result = await incrementalImport('session', filePath, deps)
  assert.equal(result.success, true)
  assert.equal(result.newMessageCount, 0)
  assert.equal(result.batch?.duplicateCount, 1)

  const readonlyDb = openBetterSqliteDatabase(dbPath, { readonly: true, nativeBinding })
  const row = readonlyDb.prepare('SELECT COUNT(*) AS count FROM message').get() as { count: number }
  readonlyDb.close()
  assert.equal(row.count, 1)
})
