import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mock, test } from 'node:test'
import Database from 'better-sqlite3'

function makeTempDir(): string {
  const baseDir = process.env.CHATLAB_TEST_TMPDIR ?? (fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir())
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-desktop-db-core-'))
}

test('openDatabase keeps readonly validation read-only for DELETE journal databases', async () => {
  const root = makeTempDir()
  const previousDataDir = process.env.CHATLAB_DATA_DIR
  process.env.CHATLAB_DATA_DIR = root

  const sessionId = 'legacy-delete-journal'
  const dbPath = path.join(root, 'databases', `${sessionId}.db`)
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })

  const setupDb = new Database(dbPath, { nativeBinding: undefined })
  setupDb.exec(`
    PRAGMA journal_mode = DELETE;
    CREATE TABLE message (id INTEGER PRIMARY KEY);
  `)
  setupDb.close()

  try {
    await mock.module('electron', {
      namedExports: {
        app: {
          getPath: () => root,
        },
      },
    })
    await mock.module('@openchatlab/node-runtime', {
      namedExports: {
        BetterSqliteAdapter: class BetterSqliteAdapter {
          constructor(readonly db: unknown) {}
        },
        writeParseResultToDb: () => undefined,
        deleteSessionCache: () => undefined,
        contactsService: {
          getContactsFactsCacheDir: () => path.join(root, 'cache', 'contacts'),
        },
        globalInsightService: {
          getGlobalInsightFactsCacheDir: () => path.join(root, 'cache', 'global-insight'),
        },
        peopleRelationshipsService: {
          getPeopleRelationshipsFactsCacheDir: () => path.join(root, 'cache', 'people-relationships'),
        },
      },
    })

    const { openDatabase } = await import('./core.js')
    const db = openDatabase(sessionId, true)
    try {
      assert.ok(db)
      assert.equal(db.pragma('journal_mode', { simple: true }), 'delete')
      assert.equal(
        db.prepare("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='message'").get().cnt,
        1
      )
    } finally {
      db?.close()
    }
  } finally {
    if (previousDataDir === undefined) {
      delete process.env.CHATLAB_DATA_DIR
    } else {
      process.env.CHATLAB_DATA_DIR = previousDataDir
    }
    fs.rmSync(root, { recursive: true, force: true })
  }
})
