import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { PathProvider } from '@openchatlab/core'
import {
  DatabaseManager,
  DataDirCompatibilityError,
  raiseDataDirMinRuntimeVersion,
  readDataDirCompatibilityMeta,
} from '@openchatlab/node-runtime'
import { analyzeIncrementalImport, incrementalImport, streamImport } from './stream-import'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

function makeTempDir(): string {
  const baseDir = fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir()
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-cli-stream-import-'))
}

function createPathProvider(root: string): PathProvider {
  return {
    getSystemDir: () => root,
    getUserDataDir: () => path.join(root, 'data'),
    getDatabaseDir: () => path.join(root, 'data', 'databases'),
    getAiDataDir: () => path.join(root, 'ai'),
    getSettingsDir: () => path.join(root, 'settings'),
    getCacheDir: () => path.join(root, 'cache'),
    getTempDir: () => path.join(root, 'temp'),
    getLogsDir: () => path.join(root, 'logs'),
    getDownloadsDir: () => path.join(root, 'downloads'),
  }
}

function writeIncrementalJsonl(filePath: string): void {
  const rows = [
    {
      _type: 'header',
      chatlab: { version: '1.0.0', exportedAt: 1780830000 },
      meta: { name: 'Incremental Chat', platform: 'qq', type: 'group' },
    },
    { _type: 'member', platformId: 'u1', accountName: 'Alice' },
    {
      _type: 'message',
      sender: 'u1',
      accountName: 'Alice',
      timestamp: 2000,
      type: 0,
      content: 'new incremental message',
      platformMessageId: 'm1',
    },
  ]
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join('\n'), 'utf-8')
}

function writeMediaJsonl(filePath: string, content = 'images/photo.jpg', platformMessageId = 'm1'): void {
  const rows = [
    {
      _type: 'header',
      chatlab: { version: '1.0.0', exportedAt: 1780830000 },
      meta: { name: 'Media Chat', platform: 'qq', type: 'group' },
    },
    { _type: 'member', platformId: 'u1', accountName: 'Alice' },
    {
      _type: 'message',
      sender: 'u1',
      accountName: 'Alice',
      timestamp: 2000,
      type: 0,
      content,
      platformMessageId,
    },
  ]
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join('\n'), 'utf-8')
}

test('incrementalImport raises the data directory gate after successful writes', async () => {
  const root = makeTempDir()
  const pathProvider = createPathProvider(root)
  const manager = new DatabaseManager(pathProvider, {
    nativeBinding,
    runtime: { version: '0.25.1', kind: 'cli' },
  })

  const db = manager.openRawSessionDatabase('existing', { create: true, initializeChatTables: true })
  db.prepare('INSERT INTO meta (name, platform, type, imported_at) VALUES (?, ?, ?, ?)').run(
    'Existing Chat',
    'qq',
    'group',
    1000
  )
  db.prepare('INSERT INTO member (platform_id, account_name) VALUES (?, ?)').run('u0', 'Existing User')
  db.close()

  const filePath = path.join(root, 'incremental.jsonl')
  writeIncrementalJsonl(filePath)

  const result = await incrementalImport(manager, 'existing', filePath)

  assert.equal(result.success, true)
  assert.equal(result.newMessageCount, 1)
  const meta = readDataDirCompatibilityMeta(pathProvider.getUserDataDir())
  assert.equal(meta?.minRuntimeVersion, '0.25.1')
  assert.equal(meta?.dataCompatibilityVersion, 1)
  assert.deepEqual(meta?.reasons, ['segment-schema'])
})

test('incrementalImport migrates legacy sessions before inserting media columns', async () => {
  const root = makeTempDir()
  const pathProvider = createPathProvider(root)
  const manager = new DatabaseManager(pathProvider, {
    nativeBinding,
    runtime: { version: '0.25.1', kind: 'cli' },
  })

  const db = manager.openRawSessionDatabase('legacy', { create: true })
  db.exec(`
    CREATE TABLE meta (
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      type TEXT NOT NULL,
      imported_at INTEGER NOT NULL,
      group_id TEXT,
      group_avatar TEXT,
      owner_id TEXT,
      session_gap_threshold INTEGER,
      schema_version INTEGER DEFAULT 6
    );
    CREATE TABLE member (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_id TEXT NOT NULL UNIQUE,
      account_name TEXT,
      group_nickname TEXT,
      aliases TEXT DEFAULT '[]',
      avatar TEXT,
      roles TEXT DEFAULT '[]'
    );
    CREATE TABLE message (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      sender_account_name TEXT,
      sender_group_nickname TEXT,
      ts INTEGER NOT NULL,
      type INTEGER NOT NULL,
      content TEXT,
      reply_to_message_id TEXT DEFAULT NULL,
      platform_message_id TEXT DEFAULT NULL
    );
    CREATE TABLE segment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      start_ts INTEGER NOT NULL,
      end_ts INTEGER NOT NULL,
      message_count INTEGER DEFAULT 0,
      is_manual INTEGER DEFAULT 0,
      summary TEXT
    );
    CREATE TABLE message_context (
      message_id INTEGER PRIMARY KEY,
      segment_id INTEGER NOT NULL,
      topic_id INTEGER
    );
    INSERT INTO meta (name, platform, type, imported_at, schema_version)
    VALUES ('Legacy Chat', 'qq', 'group', 1000, 6);
    INSERT INTO member (platform_id, account_name) VALUES ('u0', 'Existing User');
  `)
  db.close()

  const filePath = path.join(root, 'incremental.jsonl')
  writeIncrementalJsonl(filePath)

  const result = await incrementalImport(manager, 'legacy', filePath)
  assert.equal(result.success, true)
  assert.equal(result.newMessageCount, 1)

  const readDb = manager.openRawSessionDatabase('legacy', { readonly: true })
  try {
    const columns = readDb.pragma('table_info(message)') as Array<{ name: string }>
    assert.equal(
      columns.some((column) => column.name === 'media_path'),
      true
    )
    const row = readDb.prepare('SELECT content, media_path FROM message WHERE platform_message_id = ?').get('m1') as
      | { content: string; media_path: string | null }
      | undefined
    assert.deepEqual(row, { content: 'new incremental message', media_path: null })
  } finally {
    readDb.close()
  }
})

test('streamImport archives ChatLab media paths and stores media metadata', async () => {
  const root = makeTempDir()
  const pathProvider = createPathProvider(root)
  const manager = new DatabaseManager(pathProvider, {
    nativeBinding,
    runtime: { version: '0.25.1', kind: 'cli' },
  })

  const importDir = path.join(root, 'source')
  const imageDir = path.join(importDir, 'images')
  fs.mkdirSync(imageDir, { recursive: true })
  fs.writeFileSync(path.join(imageDir, 'photo.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
  const filePath = path.join(importDir, 'media.jsonl')
  writeMediaJsonl(filePath)

  const result = await streamImport(manager, filePath, { formatId: 'chatlab-jsonl' })
  assert.equal(result.success, true)
  assert.ok(result.sessionId)

  const db = manager.openRawSessionDatabase(result.sessionId!, { readonly: true })
  try {
    const row = db
      .prepare(
        'SELECT type, content, media_path, media_mime, media_filename FROM message WHERE platform_message_id = ?'
      )
      .get('m1') as {
      type: number
      content: string
      media_path: string | null
      media_mime: string | null
      media_filename: string | null
    }
    assert.equal(row.type, 1)
    assert.equal(row.content, 'images/photo.jpg')
    assert.equal(row.media_mime, 'image/jpeg')
    assert.equal(row.media_filename, 'photo.jpg')
    assert.ok(row.media_path)
    assert.equal(
      fs.existsSync(path.join(pathProvider.getUserDataDir(), 'media', result.sessionId!, row.media_path!)),
      true
    )

    const typeRow = db.prepare('SELECT COUNT(*) as count FROM message WHERE type = 1').get() as { count: number }
    assert.equal(typeRow.count, 1)
  } finally {
    db.close()
  }

  assert.equal(manager.deleteSessionDatabaseFiles(result.sessionId!), true)
  assert.equal(fs.existsSync(path.join(pathProvider.getUserDataDir(), 'media', result.sessionId!)), false)
})

test('streamImport refuses to archive media paths outside the import root', async () => {
  const root = makeTempDir()
  const pathProvider = createPathProvider(root)
  const manager = new DatabaseManager(pathProvider, {
    nativeBinding,
    runtime: { version: '0.25.1', kind: 'cli' },
  })

  const importDir = path.join(root, 'source')
  const outsideDir = path.join(root, 'outside')
  fs.mkdirSync(outsideDir, { recursive: true })
  fs.writeFileSync(path.join(outsideDir, 'secret.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
  fs.mkdirSync(importDir, { recursive: true })
  const filePath = path.join(importDir, 'media.jsonl')
  writeMediaJsonl(filePath, '../outside/secret.jpg')

  const result = await streamImport(manager, filePath, { formatId: 'chatlab-jsonl' })
  assert.equal(result.success, true)
  assert.ok(result.sessionId)

  const db = manager.openRawSessionDatabase(result.sessionId!, { readonly: true })
  try {
    const row = db
      .prepare('SELECT type, media_path, media_mime, media_filename FROM message WHERE platform_message_id = ?')
      .get('m1') as {
      type: number
      media_path: string | null
      media_mime: string | null
      media_filename: string | null
    }
    assert.equal(row.type, 1)
    assert.equal(row.media_path, null)
    assert.equal(row.media_mime, 'image/jpeg')
    assert.equal(row.media_filename, 'secret.jpg')
  } finally {
    db.close()
  }
})

test('incrementalImport archives newly added media paths', async () => {
  const root = makeTempDir()
  const pathProvider = createPathProvider(root)
  const manager = new DatabaseManager(pathProvider, {
    nativeBinding,
    runtime: { version: '0.25.1', kind: 'cli' },
  })

  const db = manager.openRawSessionDatabase('existing', { create: true, initializeChatTables: true })
  db.prepare('INSERT INTO meta (name, platform, type, imported_at) VALUES (?, ?, ?, ?)').run(
    'Existing Chat',
    'qq',
    'group',
    1000
  )
  db.prepare('INSERT INTO member (platform_id, account_name) VALUES (?, ?)').run('u1', 'Alice')
  db.close()

  const importDir = path.join(root, 'source')
  const imageDir = path.join(importDir, 'images')
  fs.mkdirSync(imageDir, { recursive: true })
  fs.writeFileSync(path.join(imageDir, 'photo.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
  const filePath = path.join(importDir, 'media.jsonl')
  writeMediaJsonl(filePath, 'images/photo.jpg', 'm-incremental')

  const result = await incrementalImport(manager, 'existing', filePath)
  assert.equal(result.success, true)
  assert.equal(result.newMessageCount, 1)

  const readDb = manager.openRawSessionDatabase('existing', { readonly: true })
  try {
    const row = readDb
      .prepare('SELECT media_path, media_mime, media_filename FROM message WHERE platform_message_id = ?')
      .get('m-incremental') as {
      media_path: string | null
      media_mime: string | null
      media_filename: string | null
    }
    assert.ok(row.media_path)
    assert.equal(row.media_mime, 'image/jpeg')
    assert.equal(row.media_filename, 'photo.jpg')
    assert.equal(fs.existsSync(path.join(pathProvider.getUserDataDir(), 'media', 'existing', row.media_path!)), true)
  } finally {
    readDb.close()
  }
})

test('analyzeIncrementalImport propagates data directory compatibility errors', async () => {
  const root = makeTempDir()
  const pathProvider = createPathProvider(root)
  fs.mkdirSync(pathProvider.getDatabaseDir(), { recursive: true })
  fs.writeFileSync(path.join(pathProvider.getDatabaseDir(), 'existing.db'), 'not opened before compatibility check')
  raiseDataDirMinRuntimeVersion(pathProvider, {
    minRuntimeVersion: '0.26.0',
    dataCompatibilityVersion: 2,
    reason: 'future-schema',
    runtime: { version: '0.26.0', kind: 'desktop' },
    module: 'future-migration',
    now: () => 1780830000,
  })
  const manager = new DatabaseManager(pathProvider, {
    nativeBinding,
    runtime: { version: '0.25.1', kind: 'cli' },
  })
  const filePath = path.join(root, 'incremental.jsonl')
  writeIncrementalJsonl(filePath)

  await assert.rejects(
    () => analyzeIncrementalImport(manager, 'existing', filePath),
    (error) => error instanceof DataDirCompatibilityError && error.code === 'DATA_DIR_REQUIRES_NEWER_RUNTIME'
  )
})
