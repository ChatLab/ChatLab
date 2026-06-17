import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import type { PathProvider } from '@openchatlab/core'
import { readDataDirCompatibilityMeta } from '@openchatlab/node-runtime/src/data-dir-compat'
import { getPendingMigrationInfos, migrateDatabase } from './migrations'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

function makeTempDir(): string {
  const baseDir = fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir()
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-desktop-migration-'))
}

function makePathProvider(root: string): PathProvider {
  return {
    getSystemDir: () => path.join(root, 'system'),
    getUserDataDir: () => path.join(root, 'data'),
    getDatabaseDir: () => path.join(root, 'data', 'databases'),
    getVectorDir: () => path.join(root, 'data', 'vector'),
    getAiDataDir: () => path.join(root, 'system', 'ai'),
    getSettingsDir: () => path.join(root, 'system', 'settings'),
    getCacheDir: () => path.join(root, 'system', 'cache'),
    getTempDir: () => path.join(root, 'system', 'temp'),
    getLogsDir: () => path.join(root, 'system', 'logs'),
    getDownloadsDir: () => path.join(root, 'downloads'),
  }
}

test('migrateDatabase writes data directory compatibility meta after segment schema migration', () => {
  const root = makeTempDir()
  const dbPath = path.join(root, 'data', 'databases', 'desktop-legacy.db')
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })

  const db = new Database(dbPath, { nativeBinding })
  db.exec(`
    CREATE TABLE meta (
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      type TEXT NOT NULL,
      imported_at INTEGER NOT NULL,
      schema_version INTEGER DEFAULT 4
    );
    INSERT INTO meta (name, platform, type, imported_at, schema_version)
    VALUES ('Desktop Legacy Chat', 'qq', 'group', 1000, 4);

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

  try {
    assert.equal(
      migrateDatabase(db, false, {
        pathProvider: makePathProvider(root),
        runtime: { version: '0.25.1', kind: 'desktop' },
      }),
      true
    )
  } finally {
    db.close()
  }

  const meta = readDataDirCompatibilityMeta(path.join(root, 'data'))
  assert.equal(meta?.minRuntimeVersion, '0.25.1')
  assert.equal(meta?.dataCompatibilityVersion, 1)
  assert.deepEqual(meta?.reasons, ['segment-schema'])
  assert.deepEqual(meta?.updatedBy, {
    runtime: 'desktop',
    module: 'chat-db-migration',
    version: '0.25.1',
  })
})

test('getPendingMigrationInfos maps each version to its own localized message', () => {
  const migrations = getPendingMigrationInfos(6)

  assert.deepEqual(
    migrations.map((m) => m.version),
    [7, 8]
  )

  const v7 = migrations[0]
  assert.match(v7.userMessage, /Repair|修复/)
  assert.doesNotMatch(v7.userMessage, /Owner/)

  // v8 必须有自己的本地化消息，而非回退到首个迁移文案
  const v8 = migrations[1]
  assert.match(v8.userMessage, /index|索引|インデックス/i)
  assert.doesNotMatch(v8.userMessage, /Owner/)
})
