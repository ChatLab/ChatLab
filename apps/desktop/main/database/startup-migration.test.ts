import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import type { PathProvider } from '@openchatlab/core'
import { readDataDirCompatibilityMeta } from '@openchatlab/node-runtime/src/data-dir-compat'
import { assertDesktopStartupMigrationSucceeded, repairDesktopStartupCompatibilityGate } from './startup-migration'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

function makeTempDir(): string {
  const baseDir = fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir()
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-startup-migration-'))
}

function makePathProvider(root: string): PathProvider {
  return {
    getSystemDir: () => path.join(root, 'system'),
    getUserDataDir: () => path.join(root, 'data'),
    getDatabaseDir: () => path.join(root, 'data', 'databases'),
    getAiDataDir: () => path.join(root, 'system', 'ai'),
    getSettingsDir: () => path.join(root, 'system', 'settings'),
    getCacheDir: () => path.join(root, 'system', 'cache'),
    getTempDir: () => path.join(root, 'system', 'temp'),
    getLogsDir: () => path.join(root, 'system', 'logs'),
    getDownloadsDir: () => path.join(root, 'downloads'),
  }
}

test('assertDesktopStartupMigrationSucceeded aborts when startup migration fails', () => {
  assert.throws(
    () =>
      assertDesktopStartupMigrationSucceeded({
        success: false,
        migratedCount: 0,
        failures: [{ sessionId: 'legacy', error: 'EACCES: permission denied' }],
        error: '1 database migration failed',
      }),
    /Database schema migration failed/
  )
})

test('assertDesktopStartupMigrationSucceeded accepts successful startup migrations', () => {
  assert.doesNotThrow(() => assertDesktopStartupMigrationSucceeded({ success: true, migratedCount: 1, failures: [] }))
})

test('repairDesktopStartupCompatibilityGate raises metadata for already migrated segment schema data', () => {
  const calls: Array<{ minRuntimeVersion: string; reason: string }> = []

  repairDesktopStartupCompatibilityGate(
    { version: '0.25.1', kind: 'desktop' },
    {
      hasCurrentSegmentSchemaData: () => true,
      raiseDataDirMinRuntimeVersion: (_pathProvider, input) => {
        calls.push({ minRuntimeVersion: input.minRuntimeVersion, reason: input.reason })
        return {
          formatVersion: 1,
          minRuntimeVersion: input.minRuntimeVersion,
          dataCompatibilityVersion: input.dataCompatibilityVersion,
          reasons: [input.reason],
          updatedBy: { runtime: input.runtime.kind, module: input.module, version: input.runtime.version },
          updatedAt: 1780830000,
        }
      },
      pathProvider: {} as never,
    }
  )

  assert.deepEqual(calls, [{ minRuntimeVersion: '0.25.1', reason: 'segment-schema' }])
})

test('repairDesktopStartupCompatibilityGate writes missing metadata for existing v6 databases', () => {
  const root = makeTempDir()
  const dbPath = path.join(root, 'data', 'databases', 'already-v6.db')
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })

  const db = new Database(dbPath, { nativeBinding })
  db.exec(`
    CREATE TABLE meta (
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      type TEXT NOT NULL,
      imported_at INTEGER NOT NULL,
      schema_version INTEGER DEFAULT 6
    );
    INSERT INTO meta (name, platform, type, imported_at, schema_version)
    VALUES ('Already V6', 'qq', 'group', 1000, 6);

    CREATE TABLE message (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      ts INTEGER NOT NULL,
      type INTEGER NOT NULL,
      content TEXT
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
  `)
  db.close()

  repairDesktopStartupCompatibilityGate(
    { version: '0.25.1', kind: 'desktop' },
    { pathProvider: makePathProvider(root), nativeBinding }
  )

  const meta = readDataDirCompatibilityMeta(path.join(root, 'data'))
  assert.equal(meta?.minRuntimeVersion, '0.25.1')
  assert.equal(meta?.dataCompatibilityVersion, 1)
  assert.deepEqual(meta?.reasons, ['segment-schema'])
})
