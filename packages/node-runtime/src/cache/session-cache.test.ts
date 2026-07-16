/**
 * Regression tests for overview cache self-invalidation.
 *
 * Key scenario: after incremental import inserts new messages the cache
 * fingerprint (MAX(message.id)) must mismatch, triggering a recompute so
 * the AI system prompt always sees the latest lastMessageTs.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { CHAT_DB_SCHEMA } from '@openchatlab/core'
import { BetterSqliteAdapter } from '../better-sqlite3-adapter'
import {
  computeAndSetOverviewCache,
  getCache,
  setCache,
  getValidatedOverviewCache,
  CACHE_KEY_OVERVIEW,
  type OverviewCache,
} from './session-cache'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

function makeTempDir(): string {
  const baseDir = process.env.CHATLAB_TEST_TMPDIR ?? (fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir())
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-session-cache-'))
}

/**
 * Create an in-memory (or temp-file) chat DB with schema and one member so
 * sender_id FK joins work.
 */
function makeTestDb(filePath?: string): Database.Database {
  const db = new Database(filePath ?? ':memory:', { nativeBinding })
  db.exec(CHAT_DB_SCHEMA)
  // Insert a system member and a regular member
  db.prepare(
    `INSERT INTO member (platform_id, account_name, group_nickname, avatar, roles)
     VALUES (?, ?, ?, NULL, '[]')`
  ).run('sys', '系统消息', null)
  db.prepare(
    `INSERT INTO member (platform_id, account_name, group_nickname, avatar, roles)
     VALUES (?, ?, ?, NULL, '[]')`
  ).run('u1', 'Alice', 'Alice')
  return db
}

function insertMessage(db: Database.Database, senderId: number, ts: number): void {
  db.prepare('INSERT INTO message (sender_id, ts, type, content) VALUES (?, ?, 0, ?)').run(senderId, ts, `msg at ${ts}`)
}

// ──────────────────────────────────────────────────────────────────────────────
// Test 1: core regression — cache becomes stale after incremental import; must recompute
// ──────────────────────────────────────────────────────────────────────────────
test('getValidatedOverviewCache recomputes when new messages are inserted after caching', () => {
  const tmpDir = makeTempDir()
  const dbPath = path.join(tmpDir, 'test.db')
  const db = makeTestDb(dbPath)
  const adapter = new BetterSqliteAdapter(db)

  // Pre-import: two messages, latest ts=1000
  insertMessage(db, 2, 500) // sender_id 2 = Alice (id=2 after sys=1)
  insertMessage(db, 2, 1000)

  // Build initial cache (simulates what postImportHook does after first import)
  computeAndSetOverviewCache(adapter, 'test-session', tmpDir)

  // Verify cache was written with correct values
  const cached = getCache<OverviewCache>('test-session', CACHE_KEY_OVERVIEW, tmpDir)
  assert.ok(cached, 'cache should exist after computeAndSetOverviewCache')
  assert.equal(cached.lastMessageTs, 1000, 'cached lastMessageTs should be 1000')

  // Simulate incremental import: insert a newer message (ts=2000)
  // This is what happens when the user imports new chat data
  insertMessage(db, 2, 2000)

  // NOW call getValidatedOverviewCache — it must detect the fingerprint mismatch
  // and recompute, returning the updated lastMessageTs=2000
  const result = getValidatedOverviewCache(adapter, 'test-session', tmpDir)
  assert.equal(
    result.lastMessageTs,
    2000,
    'getValidatedOverviewCache must return updated lastMessageTs=2000 after incremental import'
  )
})

// ──────────────────────────────────────────────────────────────────────────────
// Test 2: cache hit — no new messages means fingerprint matches, no recompute
// ──────────────────────────────────────────────────────────────────────────────
test('getValidatedOverviewCache returns cached value without recompute when data is unchanged', () => {
  const tmpDir = makeTempDir()
  const dbPath = path.join(tmpDir, 'test.db')
  const db = makeTestDb(dbPath)
  const adapter = new BetterSqliteAdapter(db)

  insertMessage(db, 2, 1000)

  computeAndSetOverviewCache(adapter, 'test-session', tmpDir)

  // Inject a stale lastMessageTs into the cache to prove we are NOT recomputing
  const staleOverride: OverviewCache & { maxMessageId: number } = {
    totalMessages: 1,
    totalMembers: 1,
    firstMessageTs: 1000,
    lastMessageTs: 999, // intentionally wrong — we want to detect if this is returned as-is
    maxMessageId: (db.prepare('SELECT MAX(id) AS m FROM message').get() as { m: number }).m,
  }
  setCache('test-session', CACHE_KEY_OVERVIEW, staleOverride, tmpDir)

  // Since no new messages were inserted, fingerprint still matches
  // The function must return the cached value (999) without recomputing
  const result = getValidatedOverviewCache(adapter, 'test-session', tmpDir)
  assert.equal(result.lastMessageTs, 999, 'should return cached value unchanged when fingerprint matches (no new data)')
})

// ──────────────────────────────────────────────────────────────────────────────
// Test 3: legacy cache without maxMessageId triggers recompute
// ──────────────────────────────────────────────────────────────────────────────
test('getValidatedOverviewCache recomputes for old cache files that lack maxMessageId', () => {
  const tmpDir = makeTempDir()
  const dbPath = path.join(tmpDir, 'test.db')
  const db = makeTestDb(dbPath)
  const adapter = new BetterSqliteAdapter(db)

  insertMessage(db, 2, 1500)

  // Manually write a legacy-format cache entry WITHOUT maxMessageId
  const legacyCache: OverviewCache = {
    totalMessages: 0,
    totalMembers: 0,
    firstMessageTs: null,
    lastMessageTs: null,
    // maxMessageId intentionally absent (legacy format)
  }
  setCache('test-session', CACHE_KEY_OVERVIEW, legacyCache, tmpDir)

  // Must recompute because maxMessageId is missing from cached value
  const result = getValidatedOverviewCache(adapter, 'test-session', tmpDir)
  assert.equal(
    result.lastMessageTs,
    1500,
    'should recompute and return real lastMessageTs when legacy cache lacks maxMessageId'
  )
})
