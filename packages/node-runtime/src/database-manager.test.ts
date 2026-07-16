import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import type { PathProvider } from '@openchatlab/core'
import { CHAT_DB_SCHEMA, CURRENT_SCHEMA_VERSION, getSessionInfo } from '@openchatlab/core'
import { DataDirCompatibilityError, readDataDirCompatibilityMeta } from './data-dir-compat'
import { DatabaseManager } from './database-manager'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

function makeTempDir(): string {
  const baseDir = process.env.CHATLAB_TEST_TMPDIR ?? (fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir())
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-db-manager-'))
}

function createPathProvider(root: string): PathProvider {
  return {
    getSystemDir: () => root,
    getUserDataDir: () => path.join(root, 'data'),
    getDatabaseDir: () => path.join(root, 'data', 'databases'),
    getVectorDir: () => path.join(root, 'data', 'vector'),
    getAiDataDir: () => path.join(root, 'ai'),
    getSettingsDir: () => path.join(root, 'settings'),
    getCacheDir: () => path.join(root, 'cache'),
    getTempDir: () => path.join(root, 'temp'),
    getLogsDir: () => path.join(root, 'logs'),
    getDownloadsDir: () => path.join(root, 'downloads'),
  }
}

function getIndexNames(db: Database.Database): string[] {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name").all() as Array<{
    name: string
  }>
  return rows.map((row) => row.name)
}

function assertAnalysisToolIndexes(db: Database.Database): void {
  const indexes = getIndexNames(db)
  assert.ok(indexes.includes('idx_message_reply_to'))
  assert.ok(indexes.includes('idx_message_sender_ts'))
  assert.ok(indexes.includes('idx_message_type_ts'))
}

test('constructor rejects missing runtime unless the test-only bypass is explicit', () => {
  const root = makeTempDir()

  assert.throws(() => new DatabaseManager(createPathProvider(root), { nativeBinding }), /runtime identity is required/i)
  assert.doesNotThrow(
    () => new DatabaseManager(createPathProvider(root), { nativeBinding, allowMissingRuntimeForTests: true })
  )
})

test('open migrates legacy member name columns before readonly queries', () => {
  const root = makeTempDir()
  const dbDir = path.join(root, 'data', 'databases')
  fs.mkdirSync(dbDir, { recursive: true })
  const dbPath = path.join(dbDir, 'legacy.db')

  const rawDb = new Database(dbPath, { nativeBinding })
  rawDb.exec(`
    CREATE TABLE meta (
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      type TEXT NOT NULL,
      imported_at INTEGER NOT NULL,
      schema_version INTEGER DEFAULT 4
    );
    INSERT INTO meta (name, platform, type, imported_at, schema_version)
    VALUES ('Legacy Chat', 'qq', 'group', 1000, 4);

    CREATE TABLE member (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      nickname TEXT
    );
    INSERT INTO member (platform_id, name, nickname) VALUES ('u1', 'Alice Account', 'Alice Group');

    CREATE TABLE message (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      ts INTEGER NOT NULL,
      type INTEGER NOT NULL,
      content TEXT
    );
    INSERT INTO message (sender_id, ts, type, content) VALUES (1, 1000, 0, 'hello');
  `)
  rawDb.close()

  const manager = new DatabaseManager(createPathProvider(root), { nativeBinding, allowMissingRuntimeForTests: true })
  const db = manager.open('legacy')
  assert.ok(db)

  const info = getSessionInfo(db)
  assert.equal(info?.name, 'Legacy Chat')
  assert.equal(info?.messageCount, 1)

  const columns = db.pragma('table_info(member)') as Array<{ name: string }>
  assert.equal(
    columns.some((col) => col.name === 'account_name'),
    true
  )
  const member = db.prepare('SELECT account_name, group_nickname FROM member WHERE platform_id = ?').get('u1') as {
    account_name: string | null
    group_nickname: string | null
  }
  assert.equal(member.account_name, 'Alice Account')
  assert.equal(member.group_nickname, 'Alice Group')

  manager.closeAll()
})

test('open backfills FTS index when migrating legacy sessions', () => {
  const root = makeTempDir()
  const dbDir = path.join(root, 'data', 'databases')
  fs.mkdirSync(dbDir, { recursive: true })
  const dbPath = path.join(dbDir, 'fts-legacy.db')

  const rawDb = new Database(dbPath, { nativeBinding })
  rawDb.exec(`
    CREATE TABLE meta (
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      type TEXT NOT NULL,
      imported_at INTEGER NOT NULL,
      schema_version INTEGER DEFAULT 3
    );
    INSERT INTO meta (name, platform, type, imported_at, schema_version)
    VALUES ('FTS Legacy Chat', 'qq', 'group', 1000, 3);

    CREATE TABLE member (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_id TEXT NOT NULL UNIQUE,
      account_name TEXT
    );
    INSERT INTO member (platform_id, account_name) VALUES ('u1', 'Alice');

    CREATE TABLE message (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      ts INTEGER NOT NULL,
      type INTEGER NOT NULL,
      content TEXT
    );
    INSERT INTO message (sender_id, ts, type, content) VALUES (1, 1000, 0, 'hello searchable history');
    INSERT INTO message (sender_id, ts, type, content) VALUES (1, 1001, 1, 'image message ignored');
  `)
  rawDb.close()

  const manager = new DatabaseManager(createPathProvider(root), { nativeBinding, allowMissingRuntimeForTests: true })
  const db = manager.open('fts-legacy')
  assert.ok(db)

  const version = db.prepare('SELECT schema_version FROM meta LIMIT 1').get() as { schema_version: number }
  assert.equal(version.schema_version, CURRENT_SCHEMA_VERSION)

  const ftsCount = db.prepare('SELECT COUNT(*) as total FROM message_fts').get() as { total: number }
  assert.equal(ftsCount.total, 1)

  const searchCount = db
    .prepare("SELECT COUNT(*) as total FROM message_fts WHERE content MATCH 'searchable'")
    .get() as { total: number }
  assert.equal(searchCount.total, 1)

  manager.closeAll()
})

test('open migrates v7 databases to include analysis tool indexes', () => {
  const root = makeTempDir()
  const dbDir = path.join(root, 'data', 'databases')
  fs.mkdirSync(dbDir, { recursive: true })
  const dbPath = path.join(dbDir, 'v7-analysis-indexes.db')

  const rawDb = new Database(dbPath, { nativeBinding })
  rawDb.exec(`
    CREATE TABLE meta (
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      type TEXT NOT NULL,
      imported_at INTEGER NOT NULL,
      schema_version INTEGER DEFAULT 7
    );
    INSERT INTO meta (name, platform, type, imported_at, schema_version)
    VALUES ('V7 Analysis Indexes', 'qq', 'group', 1000, 7);

    CREATE TABLE member (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_id TEXT NOT NULL UNIQUE,
      account_name TEXT
    );
    INSERT INTO member (platform_id, account_name) VALUES ('u1', 'Alice');

    CREATE TABLE message (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      ts INTEGER NOT NULL,
      type INTEGER NOT NULL,
      content TEXT,
      reply_to_message_id TEXT DEFAULT NULL,
      platform_message_id TEXT DEFAULT NULL
    );
    INSERT INTO message (sender_id, ts, type, content) VALUES (1, 1000, 0, 'hello indexed tools');
  `)
  rawDb.close()

  const manager = new DatabaseManager(createPathProvider(root), { nativeBinding, allowMissingRuntimeForTests: true })
  const db = manager.open('v7-analysis-indexes')
  assert.ok(db)

  const version = db.prepare('SELECT schema_version FROM meta LIMIT 1').get() as { schema_version: number }
  assert.equal(version.schema_version, CURRENT_SCHEMA_VERSION)
  assertAnalysisToolIndexes(db as unknown as Database.Database)

  manager.closeAll()
})

test('CHAT_DB_SCHEMA creates analysis tool indexes for new databases', () => {
  const db = new Database(':memory:', { nativeBinding })
  try {
    db.exec(CHAT_DB_SCHEMA)
    assertAnalysisToolIndexes(db)
  } finally {
    db.close()
  }
})

test('open migrates v2 chat_session schema to current segment schema', () => {
  const root = makeTempDir()
  const dbDir = path.join(root, 'data', 'databases')
  fs.mkdirSync(dbDir, { recursive: true })
  const dbPath = path.join(dbDir, 'v2-segment-schema.db')

  const rawDb = new Database(dbPath, { nativeBinding })
  rawDb.exec(`
    CREATE TABLE meta (
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      type TEXT NOT NULL,
      imported_at INTEGER NOT NULL,
      schema_version INTEGER DEFAULT 2
    );
    INSERT INTO meta (name, platform, type, imported_at, schema_version)
    VALUES ('V2 Segment Schema', 'qq', 'group', 1000, 2);

    CREATE TABLE member (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_id TEXT NOT NULL UNIQUE,
      account_name TEXT
    );
    INSERT INTO member (platform_id, account_name) VALUES ('u1', 'Alice');

    CREATE TABLE message (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      ts INTEGER NOT NULL,
      type INTEGER NOT NULL,
      content TEXT,
      platform_message_id TEXT DEFAULT NULL
    );
    INSERT INTO message (sender_id, ts, type, content) VALUES (1, 1000, 0, 'hello v2');
  `)
  rawDb.close()

  const manager = new DatabaseManager(createPathProvider(root), { nativeBinding, allowMissingRuntimeForTests: true })
  const db = manager.open('v2-segment-schema')
  assert.ok(db)

  const version = db.prepare('SELECT schema_version FROM meta LIMIT 1').get() as { schema_version: number }
  assert.equal(version.schema_version, CURRENT_SCHEMA_VERSION)

  const segmentTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'segment'").get()
  const legacyTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'chat_session'").get()
  assert.ok(segmentTable)
  assert.equal(legacyTable, undefined)

  const contextColumns = db.pragma('table_info(message_context)') as Array<{ name: string }>
  assert.equal(
    contextColumns.some((col) => col.name === 'segment_id'),
    true
  )
  assert.equal(
    contextColumns.some((col) => col.name === 'session_id'),
    false
  )

  manager.closeAll()
})

test('open migrates legacy chat_session rows into segment after v5 creates segment table', () => {
  const root = makeTempDir()
  const dbDir = path.join(root, 'data', 'databases')
  fs.mkdirSync(dbDir, { recursive: true })
  const dbPath = path.join(dbDir, 'legacy-segments.db')

  const rawDb = new Database(dbPath, { nativeBinding })
  rawDb.exec(`
    CREATE TABLE meta (
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      type TEXT NOT NULL,
      imported_at INTEGER NOT NULL,
      schema_version INTEGER DEFAULT 4
    );
    INSERT INTO meta (name, platform, type, imported_at, schema_version)
    VALUES ('Legacy Segment Chat', 'qq', 'group', 1000, 4);

    CREATE TABLE member (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_id TEXT NOT NULL UNIQUE,
      account_name TEXT
    );
    INSERT INTO member (platform_id, account_name) VALUES ('u1', 'Alice');

    CREATE TABLE message (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      ts INTEGER NOT NULL,
      type INTEGER NOT NULL,
      content TEXT
    );
    INSERT INTO message (sender_id, ts, type, content) VALUES (1, 1000, 0, 'hello segment');

    CREATE TABLE chat_session (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      start_ts INTEGER NOT NULL,
      end_ts INTEGER NOT NULL,
      message_count INTEGER DEFAULT 0,
      is_manual INTEGER DEFAULT 0,
      summary TEXT
    );
    INSERT INTO chat_session (id, start_ts, end_ts, message_count, is_manual, summary)
    VALUES (7, 1000, 1010, 1, 0, 'legacy summary');

    CREATE TABLE message_context (
      message_id INTEGER PRIMARY KEY,
      session_id INTEGER NOT NULL,
      topic_id INTEGER
    );
    INSERT INTO message_context (message_id, session_id, topic_id) VALUES (1, 7, 3);
  `)
  rawDb.close()

  const manager = new DatabaseManager(createPathProvider(root), {
    nativeBinding,
    runtime: { version: '0.25.1', kind: 'cli' },
  })
  const db = manager.open('legacy-segments')
  assert.ok(db)

  const version = db.prepare('SELECT schema_version FROM meta LIMIT 1').get() as { schema_version: number }
  assert.equal(version.schema_version, CURRENT_SCHEMA_VERSION)

  const legacyTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'chat_session'").get()
  assert.equal(legacyTable, undefined)

  const segment = db.prepare('SELECT id, start_ts, end_ts, message_count, summary FROM segment').get() as
    | { id: number; start_ts: number; end_ts: number; message_count: number; summary: string | null }
    | undefined
  assert.deepEqual(segment, {
    id: 7,
    start_ts: 1000,
    end_ts: 1010,
    message_count: 1,
    summary: 'legacy summary',
  })

  const contextColumns = db.pragma('table_info(message_context)') as Array<{ name: string }>
  assert.equal(
    contextColumns.some((col) => col.name === 'segment_id'),
    true
  )
  assert.equal(
    contextColumns.some((col) => col.name === 'session_id'),
    false
  )

  const context = db.prepare('SELECT message_id, segment_id, topic_id FROM message_context').get() as {
    message_id: number
    segment_id: number
    topic_id: number
  }
  assert.deepEqual(context, { message_id: 1, segment_id: 7, topic_id: 3 })

  const meta = readDataDirCompatibilityMeta(path.join(root, 'data'))
  assert.equal(meta?.minRuntimeVersion, '0.25.1')
  assert.equal(meta?.dataCompatibilityVersion, 1)
  assert.deepEqual(meta?.reasons, ['segment-schema'])
  assert.deepEqual(meta?.updatedBy, {
    runtime: 'cli',
    module: 'chat-db-migration',
    version: '0.25.1',
  })

  manager.closeAll()
})

test('open repairs a v6 segment index whose message contexts are entirely missing', () => {
  const root = makeTempDir()
  const dbDir = path.join(root, 'data', 'databases')
  fs.mkdirSync(dbDir, { recursive: true })
  const dbPath = path.join(dbDir, 'missing-segment-contexts.db')

  const rawDb = new Database(dbPath, { nativeBinding })
  rawDb.exec(`
    CREATE TABLE meta (
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      type TEXT NOT NULL,
      imported_at INTEGER NOT NULL,
      schema_version INTEGER DEFAULT 6
    );
    INSERT INTO meta (name, platform, type, imported_at, schema_version)
    VALUES ('Missing Segment Contexts', 'qq', 'group', 1000, 6);

    CREATE TABLE member (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_id TEXT NOT NULL UNIQUE,
      account_name TEXT
    );
    INSERT INTO member (id, platform_id, account_name) VALUES (1, 'u1', 'Alice');

    CREATE TABLE message (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      ts INTEGER NOT NULL,
      type INTEGER NOT NULL,
      content TEXT
    );
    INSERT INTO message (id, sender_id, ts, type, content) VALUES
      (1, 1, 1000, 0, 'first segment message'),
      (2, 1, 1100, 0, 'second segment message'),
      (3, 1, 5000, 0, 'later segment message');

    CREATE TABLE segment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      start_ts INTEGER NOT NULL,
      end_ts INTEGER NOT NULL,
      message_count INTEGER DEFAULT 0,
      is_manual INTEGER DEFAULT 0,
      summary TEXT
    );
    INSERT INTO segment (id, start_ts, end_ts, message_count, is_manual, summary) VALUES
      (7, 1000, 1100, 2, 0, 'existing summary'),
      (8, 5000, 5000, 1, 0, NULL);

    CREATE TABLE message_context (
      message_id INTEGER PRIMARY KEY,
      segment_id INTEGER NOT NULL,
      topic_id INTEGER
    );
  `)
  rawDb.close()

  const manager = new DatabaseManager(createPathProvider(root), {
    nativeBinding,
    runtime: { version: '0.26.2', kind: 'cli' },
  })
  const db = manager.open('missing-segment-contexts')
  assert.ok(db)

  const version = db.prepare('SELECT schema_version FROM meta LIMIT 1').get() as { schema_version: number }
  assert.equal(version.schema_version, CURRENT_SCHEMA_VERSION)

  const contexts = db.prepare('SELECT message_id, segment_id FROM message_context ORDER BY message_id').all() as Array<{
    message_id: number
    segment_id: number
  }>
  assert.deepEqual(contexts, [
    { message_id: 1, segment_id: 7 },
    { message_id: 2, segment_id: 7 },
    { message_id: 3, segment_id: 8 },
  ])

  const summary = db.prepare('SELECT summary FROM segment WHERE id = 7').get() as { summary: string | null }
  assert.equal(summary.summary, 'existing summary')

  manager.closeAll()
})

test('open rejects ambiguous v6 segment data instead of guessing missing message contexts', () => {
  const root = makeTempDir()
  const dbDir = path.join(root, 'data', 'databases')
  fs.mkdirSync(dbDir, { recursive: true })
  const dbPath = path.join(dbDir, 'ambiguous-segment-contexts.db')

  const rawDb = new Database(dbPath, { nativeBinding })
  rawDb.exec(`
    CREATE TABLE meta (
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      type TEXT NOT NULL,
      imported_at INTEGER NOT NULL,
      schema_version INTEGER DEFAULT 6
    );
    INSERT INTO meta (name, platform, type, imported_at, schema_version)
    VALUES ('Ambiguous Segment Contexts', 'qq', 'group', 1000, 6);

    CREATE TABLE member (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_id TEXT NOT NULL UNIQUE,
      account_name TEXT
    );
    INSERT INTO member (id, platform_id, account_name) VALUES (1, 'u1', 'Alice');

    CREATE TABLE message (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      ts INTEGER NOT NULL,
      type INTEGER NOT NULL,
      content TEXT
    );
    INSERT INTO message (id, sender_id, ts, type, content) VALUES
      (1, 1, 1000, 0, 'first message'),
      (2, 1, 1100, 0, 'second message');

    CREATE TABLE segment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      start_ts INTEGER NOT NULL,
      end_ts INTEGER NOT NULL,
      message_count INTEGER DEFAULT 0,
      is_manual INTEGER DEFAULT 0,
      summary TEXT
    );
    INSERT INTO segment (id, start_ts, end_ts, message_count, is_manual, summary)
    VALUES (7, 1000, 1100, 3, 0, 'must be preserved');

    CREATE TABLE message_context (
      message_id INTEGER PRIMARY KEY,
      segment_id INTEGER NOT NULL,
      topic_id INTEGER
    );
  `)
  rawDb.close()

  const manager = new DatabaseManager(createPathProvider(root), {
    nativeBinding,
    runtime: { version: '0.26.2', kind: 'cli' },
  })

  assert.throws(() => manager.open('ambiguous-segment-contexts'), /Cannot safely repair missing message_context rows/)

  const checkDb = new Database(dbPath, { readonly: true, nativeBinding })
  try {
    const version = checkDb.prepare('SELECT schema_version FROM meta LIMIT 1').get() as { schema_version: number }
    assert.equal(version.schema_version, 6)
    assert.equal((checkDb.prepare('SELECT COUNT(*) AS count FROM message_context').get() as { count: number }).count, 0)
    assert.equal(
      (checkDb.prepare('SELECT summary FROM segment WHERE id = 7').get() as { summary: string | null }).summary,
      'must be preserved'
    )
  } finally {
    checkDb.close()
  }
})

test('open blocks database access when data directory requires a newer runtime', () => {
  const root = makeTempDir()
  const dbDir = path.join(root, 'data', 'databases')
  fs.mkdirSync(dbDir, { recursive: true })
  const dbPath = path.join(dbDir, 'blocked.db')

  fs.writeFileSync(
    path.join(root, 'data', '.chatlab-meta.json'),
    JSON.stringify(
      {
        formatVersion: 1,
        minRuntimeVersion: '0.25.1',
        dataCompatibilityVersion: 1,
        reasons: ['segment-schema'],
        updatedBy: { runtime: 'desktop', module: 'chat-db-migration', version: '0.25.1' },
        updatedAt: 1780830000,
      },
      null,
      2
    ),
    'utf-8'
  )

  const rawDb = new Database(dbPath, { nativeBinding })
  rawDb.exec(`
    CREATE TABLE meta (
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      type TEXT NOT NULL,
      imported_at INTEGER NOT NULL,
      schema_version INTEGER DEFAULT ${CURRENT_SCHEMA_VERSION}
    );
    INSERT INTO meta (name, platform, type, imported_at, schema_version)
    VALUES ('Blocked Chat', 'qq', 'group', 1000, ${CURRENT_SCHEMA_VERSION});
  `)
  rawDb.close()

  const manager = new DatabaseManager(createPathProvider(root), {
    nativeBinding,
    runtime: { version: '0.25.0', kind: 'cli' },
  })

  assert.throws(
    () => manager.open('blocked'),
    (error) =>
      error instanceof DataDirCompatibilityError &&
      error.code === 'DATA_DIR_REQUIRES_NEWER_RUNTIME' &&
      error.minRuntimeVersion === '0.25.1'
  )
})

test('openRawSessionDatabase blocks raw access when data directory requires a newer runtime', () => {
  const root = makeTempDir()
  const dbDir = path.join(root, 'data', 'databases')
  fs.mkdirSync(dbDir, { recursive: true })
  fs.writeFileSync(
    path.join(root, 'data', '.chatlab-meta.json'),
    JSON.stringify(
      {
        formatVersion: 1,
        minRuntimeVersion: '0.25.1',
        dataCompatibilityVersion: 1,
        reasons: ['segment-schema'],
        updatedBy: { runtime: 'desktop', module: 'chat-db-migration', version: '0.25.1' },
        updatedAt: 1780830000,
      },
      null,
      2
    ),
    'utf-8'
  )

  const manager = new DatabaseManager(createPathProvider(root), {
    nativeBinding,
    runtime: { version: '0.25.0', kind: 'cli' },
  })

  assert.throws(
    () => manager.openRawSessionDatabase('blocked-raw', { create: true }),
    (error) =>
      error instanceof DataDirCompatibilityError &&
      error.code === 'DATA_DIR_REQUIRES_NEWER_RUNTIME' &&
      error.minRuntimeVersion === '0.25.1'
  )
  assert.equal(fs.existsSync(path.join(dbDir, 'blocked-raw.db')), false)
})

test('openRawSessionDatabase can initialize current chat tables for controlled import adapters', () => {
  const root = makeTempDir()
  const manager = new DatabaseManager(createPathProvider(root), {
    nativeBinding,
    runtime: { version: '0.25.1', kind: 'cli' },
  })

  const db = manager.openRawSessionDatabase('raw-created', { create: true, initializeChatTables: true })

  const metaTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get()
  const messageTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'message'").get()
  assert.ok(metaTable)
  assert.ok(messageTable)
  db.close()
})

test('raiseCurrentChatDbCompatibilityGate writes metadata for fresh current-schema databases', () => {
  const root = makeTempDir()
  const dbDir = path.join(root, 'data', 'databases')
  fs.mkdirSync(dbDir, { recursive: true })
  const dbPath = path.join(dbDir, 'fresh-current.db')

  const rawDb = new Database(dbPath, { nativeBinding })
  rawDb.exec(`
    CREATE TABLE meta (
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      type TEXT NOT NULL,
      imported_at INTEGER NOT NULL,
      schema_version INTEGER DEFAULT ${CURRENT_SCHEMA_VERSION}
    );
    INSERT INTO meta (name, platform, type, imported_at, schema_version)
    VALUES ('Fresh Current Chat', 'qq', 'group', 1000, ${CURRENT_SCHEMA_VERSION});
  `)
  rawDb.close()

  const manager = new DatabaseManager(createPathProvider(root), {
    nativeBinding,
    runtime: { version: '0.25.1', kind: 'cli' },
  })

  manager.raiseCurrentChatDbCompatibilityGate()

  const meta = readDataDirCompatibilityMeta(path.join(root, 'data'))
  assert.equal(meta?.minRuntimeVersion, '0.25.1')
  assert.equal(meta?.dataCompatibilityVersion, 1)
  assert.deepEqual(meta?.reasons, ['segment-schema'])
  assert.deepEqual(meta?.updatedBy, {
    runtime: 'cli',
    module: 'chat-db-migration',
    version: '0.25.1',
  })
})

test('open repairs the data directory gate for existing current-schema databases', () => {
  const root = makeTempDir()
  const dbDir = path.join(root, 'data', 'databases')
  fs.mkdirSync(dbDir, { recursive: true })
  const dbPath = path.join(dbDir, 'already-current.db')

  const rawDb = new Database(dbPath, { nativeBinding })
  rawDb.exec(`
    CREATE TABLE meta (
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      type TEXT NOT NULL,
      imported_at INTEGER NOT NULL,
      schema_version INTEGER DEFAULT ${CURRENT_SCHEMA_VERSION}
    );
    INSERT INTO meta (name, platform, type, imported_at, schema_version)
    VALUES ('Already Current Chat', 'qq', 'group', 1000, ${CURRENT_SCHEMA_VERSION});

    CREATE TABLE member (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_id TEXT NOT NULL UNIQUE,
      account_name TEXT
    );

    CREATE TABLE message (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      ts INTEGER NOT NULL,
      type INTEGER NOT NULL,
      content TEXT
    );
  `)
  rawDb.close()

  const manager = new DatabaseManager(createPathProvider(root), {
    nativeBinding,
    runtime: { version: '0.25.1', kind: 'cli' },
  })

  const db = manager.open('already-current')
  assert.ok(db)
  manager.closeAll()

  const meta = readDataDirCompatibilityMeta(path.join(root, 'data'))
  assert.equal(meta?.minRuntimeVersion, '0.25.1')
  assert.equal(meta?.dataCompatibilityVersion, 1)
  assert.deepEqual(meta?.reasons, ['segment-schema'])
})

test('open keeps a higher existing data directory runtime requirement after migration', () => {
  const root = makeTempDir()
  const dbDir = path.join(root, 'data', 'databases')
  fs.mkdirSync(dbDir, { recursive: true })
  const dbPath = path.join(dbDir, 'higher-meta.db')

  fs.writeFileSync(
    path.join(root, 'data', '.chatlab-meta.json'),
    JSON.stringify(
      {
        formatVersion: 1,
        minRuntimeVersion: '0.26.0',
        dataCompatibilityVersion: 2,
        reasons: ['future-schema'],
        updatedBy: { runtime: 'desktop', module: 'future-migration', version: '0.26.0' },
        updatedAt: 1780830000,
      },
      null,
      2
    ),
    'utf-8'
  )

  const rawDb = new Database(dbPath, { nativeBinding })
  rawDb.exec(`
    CREATE TABLE meta (
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      type TEXT NOT NULL,
      imported_at INTEGER NOT NULL,
      schema_version INTEGER DEFAULT 4
    );
    INSERT INTO meta (name, platform, type, imported_at, schema_version)
    VALUES ('Higher Meta Chat', 'qq', 'group', 1000, 4);

    CREATE TABLE member (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_id TEXT NOT NULL UNIQUE,
      account_name TEXT
    );

    CREATE TABLE message (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      ts INTEGER NOT NULL,
      type INTEGER NOT NULL,
      content TEXT
    );
  `)
  rawDb.close()

  const manager = new DatabaseManager(createPathProvider(root), {
    nativeBinding,
    runtime: { version: '0.26.0', kind: 'desktop' },
  })
  const db = manager.open('higher-meta')
  assert.ok(db)
  manager.closeAll()

  const meta = readDataDirCompatibilityMeta(path.join(root, 'data'))
  assert.equal(meta?.minRuntimeVersion, '0.26.0')
  assert.equal(meta?.dataCompatibilityVersion, 2)
  assert.deepEqual(meta?.reasons, ['future-schema', 'segment-schema'])
})

test(
  'open fails after a compatibility-raising migration when data directory meta cannot be written',
  { skip: process.platform === 'win32' },
  () => {
    const root = makeTempDir()
    const userDataDir = path.join(root, 'data')
    const dbDir = path.join(userDataDir, 'databases')
    fs.mkdirSync(dbDir, { recursive: true })
    const dbPath = path.join(dbDir, 'unwritable-meta.db')

    const rawDb = new Database(dbPath, { nativeBinding })
    rawDb.exec(`
      CREATE TABLE meta (
        name TEXT NOT NULL,
        platform TEXT NOT NULL,
        type TEXT NOT NULL,
        imported_at INTEGER NOT NULL,
        schema_version INTEGER DEFAULT 4
      );
      INSERT INTO meta (name, platform, type, imported_at, schema_version)
      VALUES ('Unwritable Meta Chat', 'qq', 'group', 1000, 4);

      CREATE TABLE member (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform_id TEXT NOT NULL UNIQUE,
        account_name TEXT
      );

      CREATE TABLE message (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER NOT NULL,
        ts INTEGER NOT NULL,
        type INTEGER NOT NULL,
        content TEXT
      );
    `)
    rawDb.close()

    fs.chmodSync(userDataDir, 0o555)

    try {
      const manager = new DatabaseManager(createPathProvider(root), {
        nativeBinding,
        runtime: { version: '0.25.1', kind: 'cli' },
      })

      assert.throws(() => manager.open('unwritable-meta'), /EACCES|EPERM|permission/i)
    } finally {
      fs.chmodSync(userDataDir, 0o755)
    }
  }
)

test('open preserves readonly access for current-schema databases', { skip: process.platform === 'win32' }, () => {
  const root = makeTempDir()
  const dbDir = path.join(root, 'data', 'databases')
  fs.mkdirSync(dbDir, { recursive: true })
  const dbPath = path.join(dbDir, 'current-readonly.db')

  const rawDb = new Database(dbPath, { nativeBinding })
  rawDb.exec(`
    CREATE TABLE meta (
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      type TEXT NOT NULL,
      imported_at INTEGER NOT NULL,
      schema_version INTEGER DEFAULT ${CURRENT_SCHEMA_VERSION}
    );
    INSERT INTO meta (name, platform, type, imported_at, schema_version)
    VALUES ('Current Readonly Chat', 'qq', 'group', 1000, ${CURRENT_SCHEMA_VERSION});

    CREATE TABLE member (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_id TEXT NOT NULL UNIQUE,
      account_name TEXT
    );
    INSERT INTO member (platform_id, account_name) VALUES ('u1', 'Alice');

    CREATE TABLE message (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      ts INTEGER NOT NULL,
      type INTEGER NOT NULL,
      content TEXT
    );
    INSERT INTO message (sender_id, ts, type, content) VALUES (1, 1000, 0, 'readonly current schema');
  `)
  rawDb.close()

  fs.chmodSync(dbPath, 0o444)
  fs.chmodSync(dbDir, 0o555)

  try {
    const manager = new DatabaseManager(createPathProvider(root), { nativeBinding, allowMissingRuntimeForTests: true })
    const db = manager.open('current-readonly')
    assert.ok(db)
    assert.equal(db.readonly, true)

    const info = getSessionInfo(db)
    assert.equal(info?.name, 'Current Readonly Chat')
    assert.equal(info?.messageCount, 1)

    manager.closeAll()
  } finally {
    fs.chmodSync(dbDir, 0o755)
    fs.chmodSync(dbPath, 0o644)
  }
})

test('listSessionIds ignores non-ChatLab sqlite databases without migrating them', () => {
  const root = makeTempDir()
  const dbDir = path.join(root, 'data', 'databases')
  fs.mkdirSync(dbDir, { recursive: true })
  const dbPath = path.join(dbDir, 'notes.db')

  const rawDb = new Database(dbPath, { nativeBinding })
  rawDb.exec(`
    CREATE TABLE note (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT
    );
    INSERT INTO note (content) VALUES ('not a chatlab session');
  `)
  rawDb.close()

  const manager = new DatabaseManager(createPathProvider(root), { nativeBinding, allowMissingRuntimeForTests: true })

  assert.deepEqual(manager.listSessionIds(), [])
  manager.closeAll()
})
