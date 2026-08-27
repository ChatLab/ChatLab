import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { CHAT_DB_SCHEMA, generateSessionIndex } from '@openchatlab/core'
import { openBetterSqliteDatabase } from '../better-sqlite3-adapter'
import { analyzeIncrementalImport, incrementalImport, type IncrementalImportDeps } from './incremental-importer'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

function makeTempDir(): string {
  const baseDir = process.env.CHATLAB_TEST_TMPDIR ?? (fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir())
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

function writeSystemChatLabJsonl(filePath: string): void {
  const lines = [
    {
      _type: 'header',
      chatlab: { version: '0.0.2', exportedAt: 1780330900 },
      meta: { name: 'System Events', platform: 'custom', type: 'group' },
    },
    {
      _type: 'member',
      platformId: 'alice',
      accountName: 'Alice',
    },
    {
      _type: 'message',
      sender: 'alice',
      accountName: 'Alice',
      timestamp: 1780330832,
      type: 0,
      content: 'hello',
    },
    {
      _type: 'message',
      sender: 'SYSTEM',
      accountName: 'System',
      timestamp: 1780330833,
      type: 80,
      content: 'Bob joined the group',
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

interface DedupFixtureMessage {
  timestamp?: number
  type?: number
  content?: string | null
  replyToMessageId?: string
  platformMessageId?: string
}

function writeDedupFixture(filePath: string, messages: DedupFixtureMessage[]): void {
  fs.writeFileSync(
    filePath,
    JSON.stringify({
      chatlab: { version: '0.0.2', exportedAt: 1780330900 },
      meta: { name: 'Dedup Fixture', platform: 'wechat', type: 'private' },
      members: [{ platformId: 'wxid_alice', accountName: 'Alice' }],
      messages: messages.map((message) => ({
        sender: 'wxid_alice',
        accountName: 'Alice',
        timestamp: message.timestamp ?? 1780330832,
        type: message.type ?? 0,
        content: Object.hasOwn(message, 'content') ? message.content : 'same message',
        replyToMessageId: message.replyToMessageId,
        platformMessageId: message.platformMessageId,
      })),
    }),
    'utf8'
  )
}

function seedExistingMessage(dbPath: string, message: DedupFixtureMessage): void {
  const db = openBetterSqliteDatabase(dbPath, { nativeBinding })
  db.prepare('INSERT INTO member (platform_id, account_name) VALUES (?, ?)').run('wxid_alice', 'Alice')
  const member = db.prepare('SELECT id FROM member WHERE platform_id = ?').get('wxid_alice') as { id: number }
  db.prepare(
    `INSERT INTO message (sender_id, ts, type, content, reply_to_message_id, platform_message_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    member.id,
    message.timestamp ?? 1780330832,
    message.type ?? 0,
    Object.hasOwn(message, 'content') ? (message.content ?? null) : 'same message',
    message.replyToMessageId ?? null,
    message.platformMessageId ?? null
  )
  db.close()
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
    platform: 'wechat',
  })

  const result = await incrementalImport('session', filePath, deps)
  assert.equal(result.success, true)
  assert.equal(result.newMessageCount, 1)
  assert.equal(result.batch?.writtenCount, 1)
  assert.equal(result.batch?.errorCount, 0)

  const db = openBetterSqliteDatabase(dbPath, { readonly: true, nativeBinding })
  const row = db.prepare('SELECT ts, content FROM message').get() as { ts: number; content: string } | undefined
  const ftsTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'message_fts'").get()
  db.close()

  assert.deepEqual(row, {
    ts: 1780330832,
    content: 'hello from CipherTalk',
  })
  assert.equal(ftsTable, undefined)
})

test('continues incremental session indexing with the stored gap threshold', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const dbPath = path.join(tempDir, 'session.db')
  const filePath = path.join(tempDir, 'incremental-threshold.json')
  seedSessionDb(dbPath)

  const seededDb = openBetterSqliteDatabase(dbPath, { nativeBinding })
  seededDb.prepare('INSERT INTO member (platform_id, account_name) VALUES (?, ?)').run('wxid_alice', 'Alice')
  const member = seededDb.prepare('SELECT id FROM member WHERE platform_id = ?').get('wxid_alice') as { id: number }
  seededDb
    .prepare('INSERT INTO message (sender_id, ts, type, content) VALUES (?, ?, ?, ?)')
    .run(member.id, 100, 0, 'before')
  generateSessionIndex(seededDb, 60)
  seededDb.close()

  fs.writeFileSync(
    filePath,
    JSON.stringify({
      chatlab: { version: '0.0.2', exportedAt: 200 },
      meta: { name: 'Threshold', platform: 'wechat', type: 'private' },
      members: [{ platformId: 'wxid_alice', accountName: 'Alice' }],
      messages: [
        {
          sender: 'wxid_alice',
          accountName: 'Alice',
          timestamp: 200,
          type: 0,
          content: 'after',
        },
      ],
    }),
    'utf8'
  )

  const result = await incrementalImport('session', filePath, createDeps(dbPath))
  assert.equal(result.success, true)

  const db = openBetterSqliteDatabase(dbPath, { readonly: true, nativeBinding })
  const counts = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM segment) AS segments,
         (SELECT session_gap_threshold FROM meta LIMIT 1) AS gapThreshold`
    )
    .get() as { segments: number; gapThreshold: number | null }
  db.close()

  assert.deepEqual(counts, { segments: 2, gapThreshold: 60 })
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

test('canonicalizes reserved SYSTEM senders during incremental ChatLab imports', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const dbPath = path.join(tempDir, 'session.db')
  const filePath = path.join(tempDir, 'system-events.jsonl')
  seedSessionDb(dbPath)
  writeSystemChatLabJsonl(filePath)

  const result = await incrementalImport('session', filePath, createDeps(dbPath))

  assert.equal(result.success, true)
  assert.equal(result.newMessageCount, 2)
  assert.equal(result.session?.memberCount, 1)

  const db = openBetterSqliteDatabase(dbPath, { readonly: true, nativeBinding })
  const member = db.prepare('SELECT account_name, group_nickname FROM member WHERE platform_id = ?').get('SYSTEM') as
    | { account_name: string | null; group_nickname: string | null }
    | undefined
  const message = db
    .prepare(
      `SELECT msg.sender_account_name, msg.sender_group_nickname
       FROM message msg
       JOIN member m ON m.id = msg.sender_id
       WHERE m.platform_id = ?`
    )
    .get('SYSTEM') as { sender_account_name: string | null; sender_group_nickname: string | null } | undefined
  db.close()

  assert.deepEqual(member, { account_name: '系统消息', group_nickname: '系统消息' })
  assert.deepEqual(message, { sender_account_name: '系统消息', sender_group_nickname: '系统消息' })
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
    platform: 'wechat',
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

test('preserves canonical dedup semantics while checking existing database candidates', async (t) => {
  const scenarios: Array<{
    name: string
    existing: DedupFixtureMessage
    incoming: DedupFixtureMessage[]
    expectedNew: number
    expectedDuplicates: number
    expectedPlatformIds: Array<string | null>
  }> = [
    {
      name: 'same platform ID wins even when content changed',
      existing: { platformMessageId: 'msg-1', content: 'original' },
      incoming: [{ platformMessageId: 'msg-1', content: 'edited' }],
      expectedNew: 0,
      expectedDuplicates: 1,
      expectedPlatformIds: ['msg-1'],
    },
    {
      name: 'fallback-only input matches an existing ID-bearing message',
      existing: { platformMessageId: 'msg-1' },
      incoming: [{}],
      expectedNew: 0,
      expectedDuplicates: 1,
      expectedPlatformIds: ['msg-1'],
    },
    {
      name: 'different stable IDs survive an identical fallback fingerprint',
      existing: { platformMessageId: 'msg-1' },
      incoming: [{ platformMessageId: 'msg-2' }],
      expectedNew: 1,
      expectedDuplicates: 0,
      expectedPlatformIds: ['msg-1', 'msg-2'],
    },
    {
      name: 'one fallback-only row bridges only one stable ID',
      existing: {},
      incoming: [{ platformMessageId: 'msg-1' }, { platformMessageId: 'msg-2' }],
      expectedNew: 1,
      expectedDuplicates: 1,
      expectedPlatformIds: [null, 'msg-2'],
    },
    {
      name: 'a bridged stable ID remains duplicate when repeated',
      existing: {},
      incoming: [{ platformMessageId: 'msg-1' }, { platformMessageId: 'msg-1' }, { platformMessageId: 'msg-2' }],
      expectedNew: 1,
      expectedDuplicates: 2,
      expectedPlatformIds: [null, 'msg-2'],
    },
    {
      name: 'an empty stored platform ID behaves as fallback-only',
      existing: { platformMessageId: '' },
      incoming: [{ platformMessageId: 'msg-1' }],
      expectedNew: 0,
      expectedDuplicates: 1,
      expectedPlatformIds: [''],
    },
    {
      name: 'empty and null content share the canonical fallback fingerprint',
      existing: { content: null },
      incoming: [{ content: '' }],
      expectedNew: 0,
      expectedDuplicates: 1,
      expectedPlatformIds: [null],
    },
    {
      name: 'reply target remains part of the fallback fingerprint',
      existing: { replyToMessageId: 'reply-1' },
      incoming: [{ replyToMessageId: 'reply-2' }],
      expectedNew: 1,
      expectedDuplicates: 0,
      expectedPlatformIds: [null, null],
    },
  ]

  for (const scenario of scenarios) {
    await t.test(scenario.name, async (st) => {
      const tempDir = makeTempDir()
      st.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

      const dbPath = path.join(tempDir, 'session.db')
      const filePath = path.join(tempDir, 'incoming.json')
      seedSessionDb(dbPath)
      seedExistingMessage(dbPath, scenario.existing)
      writeDedupFixture(filePath, scenario.incoming)

      const deps = createDeps(dbPath)
      const analysis = await analyzeIncrementalImport('session', filePath, deps)
      assert.equal(analysis.newMessageCount, scenario.expectedNew)
      assert.equal(analysis.duplicateCount, scenario.expectedDuplicates)

      const result = await incrementalImport('session', filePath, deps)
      assert.equal(result.success, true)
      assert.equal(result.newMessageCount, scenario.expectedNew)
      assert.equal(result.batch?.duplicateCount, scenario.expectedDuplicates)

      const db = openBetterSqliteDatabase(dbPath, { readonly: true, nativeBinding })
      const rows = db.prepare('SELECT platform_message_id FROM message ORDER BY id').all() as Array<{
        platform_message_id: string | null
      }>
      db.close()
      assert.deepEqual(
        rows.map((row) => row.platform_message_id),
        scenario.expectedPlatformIds
      )
    })
  }
})

test('bridges stable IDs to repeated fallback-only occurrences one for one', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const dbPath = path.join(tempDir, 'session.db')
  const filePath = path.join(tempDir, 'incoming.json')
  seedSessionDb(dbPath)
  seedExistingMessage(dbPath, {})

  const seededDb = openBetterSqliteDatabase(dbPath, { nativeBinding })
  const member = seededDb.prepare('SELECT id FROM member WHERE platform_id = ?').get('wxid_alice') as { id: number }
  seededDb
    .prepare('INSERT INTO message (sender_id, ts, type, content) VALUES (?, ?, ?, ?)')
    .run(member.id, 1780330832, 0, 'same message')
  seededDb.close()

  fs.writeFileSync(
    filePath,
    JSON.stringify({
      weflow: { version: '1.0.0' },
      session: { wxid: 'wxid_alice', displayName: 'Alice', type: '私聊' },
      messages: ['msg-1', 'msg-2', 'msg-3'].map((platformMessageId, index) => ({
        localId: index + 1,
        platformMessageId,
        createTime: 1780330832,
        type: '文本消息',
        content: 'same message',
        senderUsername: 'wxid_alice',
        senderDisplayName: 'Alice',
      })),
    })
  )

  const deps = createDeps(dbPath)
  const analysis = await analyzeIncrementalImport('session', filePath, deps, { formatId: 'weflow' })
  assert.equal(analysis.newMessageCount, 1)
  assert.equal(analysis.duplicateCount, 2)

  const result = await incrementalImport('session', filePath, deps, { formatId: 'weflow' })
  assert.equal(result.success, true)
  assert.equal(result.newMessageCount, 1)
  assert.equal(result.batch?.duplicateCount, 2)

  const db = openBetterSqliteDatabase(dbPath, { readonly: true, nativeBinding })
  const rows = db.prepare('SELECT platform_message_id FROM message ORDER BY id').all() as Array<{
    platform_message_id: string | null
  }>
  db.close()
  assert.deepEqual(
    rows.map((row) => row.platform_message_id),
    [null, null, 'msg-3']
  )
})

test('deduplicates repeated input across parser message batches', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const dbPath = path.join(tempDir, 'session.db')
  const filePath = path.join(tempDir, 'cross-batch.jsonl')
  seedSessionDb(dbPath)

  const lines: unknown[] = [
    {
      _type: 'header',
      chatlab: { version: '0.0.2', exportedAt: 1780330900 },
      meta: { name: 'Cross Batch', platform: 'wechat', type: 'private' },
    },
    { _type: 'member', platformId: 'wxid_alice', accountName: 'Alice' },
  ]
  for (let index = 0; index < 5000; index++) {
    lines.push({
      _type: 'message',
      sender: 'wxid_alice',
      timestamp: 1780330832 + index,
      type: 0,
      content: `message-${index}`,
      platformMessageId: `msg-${index}`,
    })
  }
  lines.push({
    _type: 'message',
    sender: 'wxid_alice',
    timestamp: 1780330832,
    type: 0,
    content: 'message-0',
    platformMessageId: 'msg-0',
  })
  fs.writeFileSync(filePath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8')

  const deps = createDeps(dbPath)
  const analysis = await analyzeIncrementalImport('session', filePath, deps)
  assert.equal(analysis.newMessageCount, 5000)
  assert.equal(analysis.duplicateCount, 1)

  const result = await incrementalImport('session', filePath, deps)
  assert.equal(result.success, true)
  assert.equal(result.newMessageCount, 5000)
  assert.equal(result.batch?.duplicateCount, 1)
})
