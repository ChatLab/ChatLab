import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import type { PathProvider } from '@openchatlab/core'
import { CURRENT_SCHEMA_VERSION, getSessionInfo } from '@openchatlab/core'
import { DatabaseManager } from './database-manager'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

function makeTempDir(): string {
  const baseDir = fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir()
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-db-manager-'))
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

  const manager = new DatabaseManager(createPathProvider(root), { nativeBinding })
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

  const manager = new DatabaseManager(createPathProvider(root), { nativeBinding })
  const db = manager.open('fts-legacy')
  assert.ok(db)

  const version = db.prepare('SELECT schema_version FROM meta LIMIT 1').get() as { schema_version: number }
  assert.equal(version.schema_version, 5)

  const ftsCount = db.prepare('SELECT COUNT(*) as total FROM message_fts').get() as { total: number }
  assert.equal(ftsCount.total, 1)

  const searchCount = db
    .prepare("SELECT COUNT(*) as total FROM message_fts WHERE content MATCH 'searchable'")
    .get() as { total: number }
  assert.equal(searchCount.total, 1)

  manager.closeAll()
})

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
    const manager = new DatabaseManager(createPathProvider(root), { nativeBinding })
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

  const manager = new DatabaseManager(createPathProvider(root), { nativeBinding })

  assert.deepEqual(manager.listSessionIds(), [])
  manager.closeAll()
})
