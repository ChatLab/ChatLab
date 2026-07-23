import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import sqlite3InitModule, { type Database, type SAHPoolUtil } from '@sqlite.org/sqlite-wasm'
import { CURRENT_SCHEMA_VERSION, getHourlyActivity } from '@openchatlab/core'
import { BrowserDatabaseRuntime } from './database-runtime'
import type { WebRuntimeLockManager } from './workspace-lease'

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
    pauseVfs: () => pool,
    unpauseVfs: async () => pool,
    isPaused: () => false,
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
      'opfs-workspace-lock-waiting',
      'opfs-workspace-lock-acquired',
      'sqlite-initializing',
      'sqlite-ready',
      'opfs-pool-initializing',
      'opfs-pool-ready',
      'opfs-database-opening',
      'opfs-database-opened',
      'schema-initializing',
      'schema-ready',
      'opfs-pool-pausing',
      'opfs-pool-paused',
      'opfs-workspace-lock-released',
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

  it('pauses the SAH pool after a scoped workspace task completes', async () => {
    const sqlite3 = await sqlite3InitModule()
    const events: string[] = []
    let paused = false
    class MemoryPoolDatabase {
      constructor() {
        return new sqlite3.oo1.DB(':memory:', 'c')
      }
    }
    const pool = {
      OpfsSAHPoolDb: MemoryPoolDatabase,
      pauseVfs() {
        events.push('paused')
        paused = true
        return pool
      },
      async unpauseVfs() {
        events.push('resumed')
        paused = false
        return pool
      },
      isPaused: () => paused,
    } as unknown as SAHPoolUtil
    const runtime = new BrowserDatabaseRuntime(async () => ({ sqlite3, pool }))

    await runtime.withWorkspaceLease(async () => {
      events.push('first-task')
    })
    await runtime.withWorkspaceLease(async () => {
      events.push('second-task')
    })

    assert.deepEqual(events, ['first-task', 'paused', 'resumed', 'second-task', 'paused'])
  })

  it('serializes two runtimes so the first pool pauses before the second pool initializes', async () => {
    const sqlite3 = await sqlite3InitModule()
    const events: string[] = []
    const lockManager = new TestLockManager()
    let activePool: string | undefined

    const createRuntime = (name: string) =>
      new BrowserDatabaseRuntime(async () => {
        if (activePool) throw new DOMException(`Pool ${activePool} is active`, 'NoModificationAllowedError')
        activePool = name
        events.push(`${name}-initialized`)
        let paused = false
        const pool = {
          isPaused: () => paused,
          pauseVfs() {
            paused = true
            activePool = undefined
            events.push(`${name}-paused`)
            return pool
          },
          async unpauseVfs() {
            if (activePool) throw new DOMException(`Pool ${activePool} is active`, 'NoModificationAllowedError')
            paused = false
            activePool = name
            events.push(`${name}-resumed`)
            return pool
          },
        } as unknown as SAHPoolUtil
        return { sqlite3, pool }
      }, lockManager)

    const first = createRuntime('first')
    const second = createRuntime('second')
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let firstStarted!: () => void
    const firstStartedPromise = new Promise<void>((resolve) => {
      firstStarted = resolve
    })

    const firstTask = first.withWorkspaceLease(async () => {
      events.push('first-task')
      firstStarted()
      await firstGate
    })
    await firstStartedPromise

    let secondRan = false
    const secondTask = second.withWorkspaceLease(async () => {
      secondRan = true
      events.push('second-task')
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(secondRan, false)

    releaseFirst()
    await Promise.all([firstTask, secondTask])

    assert.deepEqual(events, [
      'first-initialized',
      'first-task',
      'first-paused',
      'second-initialized',
      'second-task',
      'second-paused',
    ])
  })
})

class TestLockManager implements WebRuntimeLockManager {
  private active = false
  private readonly queue: Array<() => void> = []

  request(_name: string, _options: { mode: 'exclusive' }, callback: (lock: object) => Promise<void>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const run = () => {
        this.active = true
        void callback({})
          .then(resolve, reject)
          .finally(() => {
            this.active = false
            this.queue.shift()?.()
          })
      }
      if (this.active) {
        this.queue.push(run)
      } else {
        run()
      }
    })
  }
}
