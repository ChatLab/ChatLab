/**
 * Tests for the message full-text search index helpers.
 *
 * Guards the user-visible promise of keyword search over an indexed database:
 * the index must exist after a first open, must cover every message after a
 * bulk import that bypassed the triggers, and must stay in sync when messages
 * are inserted, edited or deleted — otherwise searches silently miss messages.
 * The expression builders are covered separately because a mis-quoted keyword
 * is either an FTS5 syntax error or a wrong hit set.
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import type Database from 'better-sqlite3'
import { CHAT_DB_TABLES, MESSAGE_FTS_DDL } from '../schema/tables'
import {
  buildFtsMatchExpression,
  canUseFtsKeywords,
  ensureMessageSearchIndex,
  hasMessageSearchIndex,
  hasMessageSearchIndexAsync,
} from './search-index'
import { SqliteTestAdapter } from './__tests__/sqlite-test-adapter'
import { openTestSqliteDatabase } from '../../../../tests/helpers/sqlite.mts'

function seedMessages(raw: Database.Database, contents: string[]): void {
  raw.exec(CHAT_DB_TABLES)
  raw.prepare(`INSERT INTO member (id, platform_id, account_name) VALUES (1, 'u1', 'Alice')`).run()
  const insert = raw.prepare(`INSERT INTO message (id, sender_id, ts, type, content) VALUES (?, 1, ?, 0, ?)`)
  contents.forEach((content, index) => insert.run(index + 1, 1_700_000_000 + index, content))
}

/** Rows the index actually returns for a MATCH, independent of the message table. */
function ftsRowids(raw: Database.Database, match: string): number[] {
  return (raw.prepare(`SELECT rowid FROM message_fts WHERE message_fts MATCH ?`).all(match) as Array<{ rowid: number }>)
    .map((row) => row.rowid)
    .sort((left, right) => left - right)
}

describe('ensureMessageSearchIndex', () => {
  let raw: Database.Database
  let db: SqliteTestAdapter

  beforeEach(() => {
    raw = openTestSqliteDatabase()
    db = new SqliteTestAdapter(raw)
    seedMessages(raw, ['今天天气不错，我们出去玩吧', '周末一起打球吗', 'weekend project meeting', '[图片]'])
  })

  afterEach(() => raw.close())

  it('creates and backfills the index for rows written before it existed', () => {
    assert.equal(hasMessageSearchIndex(db), false)

    const result = ensureMessageSearchIndex(db)

    assert.equal(result.rebuilt, true)
    assert.equal(result.rows, 4)
    assert.ok(result.durationMs >= 0)
    assert.equal(hasMessageSearchIndex(db), true)
    assert.deepEqual(ftsRowids(raw, '"天气不错"'), [1])
    assert.deepEqual(ftsRowids(raw, '"weekend"'), [3])
  })

  it('is a no-op once the index already covers every message', () => {
    ensureMessageSearchIndex(db)

    const second = ensureMessageSearchIndex(new SqliteTestAdapter(raw))

    assert.equal(second.rebuilt, false)
    assert.equal(second.rows, 4)
  })

  it('rebuilds when a bulk insert bypassed the triggers', () => {
    ensureMessageSearchIndex(db)
    // A bulk importer that created the index before writing would leave rows unindexed;
    // deleting the index content simulates that state without depending on import code.
    raw.exec(`INSERT INTO message_fts(message_fts) VALUES('delete-all')`)
    assert.deepEqual(ftsRowids(raw, '"天气不错"'), [])

    const result = ensureMessageSearchIndex(new SqliteTestAdapter(raw))

    assert.equal(result.rebuilt, true)
    assert.equal(result.rows, 4)
    assert.deepEqual(ftsRowids(raw, '"天气不错"'), [1])
  })

  it('keeps the index in sync through insert, update and delete', () => {
    ensureMessageSearchIndex(db)

    raw
      .prepare(`INSERT INTO message (id, sender_id, ts, type, content) VALUES (5, 1, 1700000099, 0, ?)`)
      .run('明天去老地方')
    assert.deepEqual(ftsRowids(raw, '"老地方"'), [5])

    raw.prepare(`UPDATE message SET content = ? WHERE id = 5`).run('明天去新球场')
    assert.deepEqual(ftsRowids(raw, '"老地方"'), [])
    assert.deepEqual(ftsRowids(raw, '"新球场"'), [5])

    raw.prepare(`DELETE FROM message WHERE id = 5`).run()
    assert.deepEqual(ftsRowids(raw, '"新球场"'), [])

    // A desynced external-content index reports rows the message table no longer has.
    assert.equal(ensureMessageSearchIndex(new SqliteTestAdapter(raw)).rebuilt, false)
  })

  it('reports index presence to async executors', async () => {
    const executor = {
      all: async <T>(sql: string, params: unknown[] = []) => raw.prepare(sql).all(...params) as T[],
      get: async <T>(sql: string, params: unknown[] = []) => raw.prepare(sql).get(...params) as T | undefined,
    }

    assert.equal(await hasMessageSearchIndexAsync(executor), false)
    raw.exec(MESSAGE_FTS_DDL)
    assert.equal(await hasMessageSearchIndexAsync(executor), true)
  })
})

describe('canUseFtsKeywords', () => {
  const cases: Array<{ keywords: string[]; expected: boolean; why: string }> = [
    { keywords: [], expected: false, why: 'no keywords' },
    { keywords: ['天气'], expected: false, why: 'two Chinese characters are below the trigram floor' },
    { keywords: ['天气不错'], expected: true, why: 'four Chinese characters' },
    { keywords: ['老地方', '打球吗'], expected: true, why: 'every keyword long enough' },
    { keywords: ['老地方', '天气'], expected: false, why: 'one short keyword disqualifies the whole set' },
    { keywords: ['  周末打球  '], expected: true, why: 'length is measured after trimming' },
    { keywords: [' ab '], expected: false, why: 'padding does not make a short keyword usable' },
    { keywords: ['abc'], expected: true, why: 'three ASCII characters' },
    { keywords: ['😀😀😀'], expected: true, why: 'counted in code points, not UTF-16 units' },
    { keywords: ['😀😀'], expected: false, why: 'two emoji are two code points' },
  ]

  for (const { keywords, expected, why } of cases) {
    it(`${JSON.stringify(keywords)} → ${expected} (${why})`, () => {
      assert.equal(canUseFtsKeywords(keywords), expected)
    })
  }
})

describe('buildFtsMatchExpression', () => {
  it('quotes each keyword and joins by match mode', () => {
    assert.equal(buildFtsMatchExpression(['老地方'], 'any'), '"老地方"')
    assert.equal(buildFtsMatchExpression(['老地方', '打球吗'], 'any'), '"老地方" OR "打球吗"')
    assert.equal(buildFtsMatchExpression(['老地方', '打球吗'], 'all'), '"老地方" AND "打球吗"')
  })

  it('doubles embedded quotes and keeps other syntax literal', () => {
    assert.equal(buildFtsMatchExpression(['say "hi"'], 'any'), '"say ""hi"""')
    assert.equal(buildFtsMatchExpression(["it's ok"], 'any'), `"it's ok"`)
    assert.equal(buildFtsMatchExpression(['a OR b'], 'any'), '"a OR b"')
  })

  it('produces expressions SQLite accepts and matches literally', () => {
    const raw = openTestSqliteDatabase()
    try {
      seedMessages(raw, ['he said "good morning" today', 'good morning everyone', 'NOT good AND morning'])
      ensureMessageSearchIndex(new SqliteTestAdapter(raw))

      assert.deepEqual(ftsRowids(raw, buildFtsMatchExpression(['"good morning"'], 'any')), [1])
      assert.deepEqual(ftsRowids(raw, buildFtsMatchExpression(['good morning'], 'any')), [1, 2])
      assert.deepEqual(ftsRowids(raw, buildFtsMatchExpression(['NOT good AND morning'], 'any')), [3])
      assert.deepEqual(ftsRowids(raw, buildFtsMatchExpression(['said', 'everyone'], 'all')), [])
      assert.deepEqual(ftsRowids(raw, buildFtsMatchExpression(['said', 'everyone'], 'any')), [1, 2])
    } finally {
      raw.close()
    }
  })
})
