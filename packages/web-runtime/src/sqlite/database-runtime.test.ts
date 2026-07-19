import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import sqlite3InitModule, { type Database, type SAHPoolUtil } from '@sqlite.org/sqlite-wasm'
import { CURRENT_SCHEMA_VERSION, getHourlyActivity } from '@openchatlab/core'
import { BrowserDatabaseRuntime } from './database-runtime'

async function createMemoryRuntime(options: { initializationFailures?: number } = {}): Promise<{
  runtime: BrowserDatabaseRuntime
  openedDatabases: Database[]
  filenames: Set<string>
}> {
  const sqlite3 = await sqlite3InitModule()
  const openedDatabases: Database[] = []
  const filenames = new Set<string>()

  class MemoryPoolDatabase {
    constructor(filename: string) {
      const db = new sqlite3.oo1.DB(':memory:', 'c')
      openedDatabases.push(db)
      filenames.add(filename)
      return db
    }
  }

  const pool = {
    OpfsSAHPoolDb: MemoryPoolDatabase,
    unlink: (filename: string) => filenames.delete(filename),
    reserveMinimumCapacity: async (minimum: number) => minimum,
    getFileNames: () => [...filenames],
  } as unknown as SAHPoolUtil
  let remainingInitializationFailures = options.initializationFailures ?? 0
  return {
    runtime: new BrowserDatabaseRuntime(async (onStage) => {
      if (remainingInitializationFailures > 0) {
        remainingInitializationFailures -= 1
        throw new Error('simulated sqlite initialization failure')
      }
      onStage?.('sqlite-initializing')
      onStage?.('sqlite-ready')
      onStage?.('opfs-pool-initializing')
      onStage?.('opfs-pool-ready')
      return { sqlite3, pool }
    }),
    openedDatabases,
    filenames,
  }
}

describe('BrowserDatabaseRuntime', () => {
  it('retries SQLite initialization after a previous attempt fails', async () => {
    const { runtime } = await createMemoryRuntime({ initializationFailures: 1 })

    await assert.rejects(runtime.open('/session.db'), /simulated sqlite initialization failure/)
    await assert.doesNotReject(runtime.open('/session.db'))
    await runtime.close()
  })

  it('opens one absolute database, initializes the core schema, and closes it', async () => {
    const { runtime, openedDatabases } = await createMemoryRuntime()

    const opened = await runtime.open('/session.db')
    assert.deepEqual(opened, {
      filename: '/session.db',
      sqliteVersion: '3.53.0',
      schemaVersion: CURRENT_SCHEMA_VERSION,
    })

    const db = runtime.getOpenDatabase()
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()
    assert.equal(
      tables.some((table) => table.name === 'message'),
      true
    )
    assert.equal(getHourlyActivity(db).length, 24)

    assert.deepEqual(await runtime.close(), { closed: true })
    assert.equal(openedDatabases[0].isOpen(), false)
    assert.throws(() => runtime.getOpenDatabase(), /No database is open/)
    assert.deepEqual(await runtime.close(), { closed: false })
  })

  it('rejects relative filenames and a second database while one is open', async () => {
    const { runtime } = await createMemoryRuntime()

    await assert.rejects(runtime.open('relative.db'), /absolute/)
    await runtime.open('/first.db')
    await assert.rejects(runtime.open('/second.db'), /already open/)
    await runtime.close()
  })

  it('runs scoped workspace operations, grows the pool, and deletes only a closed named database', async () => {
    const { runtime, openedDatabases, filenames } = await createMemoryRuntime()
    const stages: string[] = []

    const count = await runtime.withDatabase(
      '/catalog.db',
      'CREATE TABLE item (id INTEGER PRIMARY KEY, name TEXT NOT NULL);',
      (db) => {
        db.prepare('INSERT INTO item (name) VALUES (?)').run('one')
        return (db.prepare('SELECT COUNT(*) AS count FROM item').get() as { count: number }).count
      },
      (stage) => stages.push(stage)
    )

    assert.equal(count, 1)
    assert.deepEqual(stages, [
      'sqlite-initializing',
      'sqlite-ready',
      'opfs-pool-initializing',
      'opfs-pool-ready',
      'opfs-database-opening',
      'opfs-database-opened',
      'schema-initializing',
      'schema-ready',
    ])
    assert.equal(openedDatabases[0].isOpen(), false)
    assert.deepEqual(await runtime.getDatabaseFilenames(), ['/catalog.db'])
    assert.equal(await runtime.ensureCapacity(12), 12)
    assert.equal(await runtime.deleteDatabase('/catalog.db'), true)
    assert.equal(filenames.has('/catalog.db'), false)

    await runtime.open('/held.db')
    await assert.rejects(
      runtime.withDatabase('/other.db', '', () => undefined),
      /already open/
    )
    await assert.rejects(runtime.deleteDatabase('/held.db'), /must be closed/)
    await runtime.close()
  })
})
