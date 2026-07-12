import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { BetterSqliteAdapter } from '../../better-sqlite3-adapter'
import type { SessionRuntimeAdapter } from '../adapters'
import { computeAnnualSummarySnapshot } from './compute'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

test('computes a snapshot across sessions and reuses versioned facts', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-global-insight-compute-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const dbPath = path.join(dir, 'chat.db')
  const raw = new Database(dbPath, { nativeBinding })
  t.after(() => raw.close())
  raw.exec(`
    CREATE TABLE meta (name TEXT, platform TEXT, type TEXT, imported_at INTEGER, owner_id TEXT);
    CREATE TABLE member (id INTEGER PRIMARY KEY, platform_id TEXT, account_name TEXT, group_nickname TEXT, aliases TEXT, avatar TEXT);
    CREATE TABLE message (id INTEGER PRIMARY KEY, sender_id INTEGER, ts INTEGER, type INTEGER, content TEXT, platform_message_id TEXT, reply_to_message_id TEXT);
    INSERT INTO meta VALUES ('Private', 'weixin', 'private', 1, 'owner');
    INSERT INTO member VALUES (1, 'owner', 'Me', NULL, '[]', NULL), (2, 'alice', 'Alice', NULL, '[]', NULL);
  `)
  const ts = Math.floor(new Date(2026, 0, 2, 12).getTime() / 1000)
  raw.prepare('INSERT INTO message VALUES (?, ?, ?, ?, ?, ?, ?)').run(1, 1, ts, 0, 'hello', 'm1', null)
  const db = new BetterSqliteAdapter(raw)
  const adapter = {
    listSessionIds: () => ['chat-1', 'broken'],
    getDbPath: (id: string) => (id === 'chat-1' ? dbPath : path.join(dir, 'broken.db')),
    openReadonly: (id: string) => {
      if (id === 'broken') throw new Error('broken database')
      return db
    },
  } as unknown as SessionRuntimeAdapter
  const range = {
    mode: 'year' as const,
    year: 2026,
    startTs: Math.floor(new Date(2026, 0, 1).getTime() / 1000),
    endTs: Math.floor(new Date(2026, 0, 3).getTime() / 1000),
  }
  const factsCacheDir = path.join(dir, 'facts')

  const first = computeAnnualSummarySnapshot({
    adapter,
    signature: 'sig',
    range,
    factsCacheDir,
    now: () => 1000,
  })
  const second = computeAnnualSummarySnapshot({
    adapter,
    signature: 'sig',
    range,
    factsCacheDir,
    now: () => 2000,
  })

  assert.equal(first.metrics.sentMessageCount, 1)
  assert.deepEqual(first.coverage, {
    totalSessions: 2,
    analyzedSessions: 1,
    missingOwnerSessions: 0,
    unresolvedOwnerSessions: 0,
    failedSessions: 1,
  })
  assert.equal(first.workerStats.cacheMisses, 2)
  assert.equal(second.workerStats.cacheHits, 1)
  assert.equal(second.workerStats.cacheMisses, 1)
  assert.equal(second.computedAt, 2000)
})
