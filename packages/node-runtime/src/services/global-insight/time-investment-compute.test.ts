import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { BetterSqliteAdapter } from '../../better-sqlite3-adapter'
import type { SessionRuntimeAdapter } from '../adapters'
import { computeTimeInvestmentSnapshot } from './time-investment-compute'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

test('computes time investment across sessions and reuses versioned facts', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-time-investment-compute-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const dbPath = path.join(dir, 'chat.db')
  const raw = new Database(dbPath, { nativeBinding })
  t.after(() => raw.close())
  raw.exec(`
    CREATE TABLE meta (name TEXT, platform TEXT, type TEXT, imported_at INTEGER, owner_id TEXT);
    CREATE TABLE member (id INTEGER PRIMARY KEY, platform_id TEXT, account_name TEXT, group_nickname TEXT, aliases TEXT, avatar TEXT);
    CREATE TABLE message (id INTEGER PRIMARY KEY, sender_id INTEGER, ts INTEGER, type INTEGER, content TEXT);
    INSERT INTO meta VALUES ('Private', 'qq', 'private', 1, 'owner');
    INSERT INTO member VALUES (1, 'owner', 'Me', NULL, '[]', NULL), (2, 'alice', 'Alice', NULL, '[]', NULL);
  `)
  const ts = Math.floor(new Date(2026, 0, 2, 12).getTime() / 1000)
  raw.prepare('INSERT INTO message VALUES (?, ?, ?, ?, ?)').run(1, 2, ts - 60, 0, 'trigger')
  raw.prepare('INSERT INTO message VALUES (?, ?, ?, ?, ?)').run(2, 1, ts, 1, '[image]')
  raw.prepare('INSERT INTO message VALUES (?, ?, ?, ?, ?)').run(3, 2, ts + 60, 0, 'reply')
  const db = new BetterSqliteAdapter(raw)
  const adapter = {
    listSessionIds: () => ['chat-1'],
    getDbPath: () => dbPath,
    openReadonly: () => db,
  } as unknown as SessionRuntimeAdapter
  const range = {
    mode: 'year' as const,
    year: 2026,
    startTs: Math.floor(new Date(2026, 0, 1).getTime() / 1000),
    endTs: Math.floor(new Date(2026, 11, 31, 23, 59, 59).getTime() / 1000),
  }
  const factsCacheDir = path.join(dir, 'facts')

  const first = computeTimeInvestmentSnapshot({ adapter, signature: 'sig', range, factsCacheDir, now: () => 1000 })
  const second = computeTimeInvestmentSnapshot({ adapter, signature: 'sig', range, factsCacheDir, now: () => 2000 })

  assert.equal(first.metrics.estimatedSeconds, 180)
  assert.equal(first.sessionRanking[0].sessionId, 'chat-1')
  assert.equal(first.workerStats.cacheMisses, 1)
  assert.equal(second.workerStats.cacheHits, 1)
  assert.equal(second.computedAt, 2000)
})
