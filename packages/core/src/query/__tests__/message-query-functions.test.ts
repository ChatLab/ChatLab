/**
 * Behavior tests for shared async message query functions.
 *
 * Run: npx tsx --test packages/core/src/query/__tests__/message-query-functions.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import Database from 'better-sqlite3'
import { getMessageContext, getSearchMessageContext } from '../message-queries'
import { SqliteTestAdapter } from './sqlite-test-adapter'

import {
  fetchAllRecentMessages,
  fetchConversationBetween,
  fetchMessageContext,
  fetchMessagesAfter,
  fetchMessagesBefore,
  fetchRecentTextMessages,
  fetchSearchMessageContext,
  searchMessagesLikeAsync,
  type AsyncSqlExecutor,
} from '../message-query-functions'

function createSqliteExecutor(db: Database.Database): AsyncSqlExecutor {
  return {
    all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      return Promise.resolve(db.prepare(sql).all(...params) as T[])
    },
    get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
      return Promise.resolve(db.prepare(sql).get(...params) as T | undefined)
    },
  }
}

function createMessageDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE member (
      id INTEGER PRIMARY KEY,
      platform_id TEXT NOT NULL,
      account_name TEXT,
      group_nickname TEXT,
      aliases TEXT DEFAULT '[]',
      avatar TEXT
    );
    CREATE TABLE message (
      id INTEGER PRIMARY KEY,
      sender_id INTEGER NOT NULL,
      ts INTEGER NOT NULL,
      type INTEGER NOT NULL,
      content TEXT,
      reply_to_message_id TEXT,
      platform_message_id TEXT
    );
    INSERT INTO member (id, platform_id, account_name, group_nickname, aliases) VALUES
      (1, 'alice', 'Alice', 'A', '["Ally"]'),
      (2, 'bob', 'Bob', NULL, '[]'),
      (99, 'system', '系统消息', NULL, '[]');
    INSERT INTO message (id, sender_id, ts, type, content) VALUES
      (1, 1, 100, 0, 'hello'),
      (2, 2, 200, 1, '[Image]'),
      (3, 1, 300, 0, 'hello project'),
      (4, 99, 400, 0, 'hello system'),
      (5, 2, 500, 0, 'hi'),
      (6, 1, 600, 0, 'hello later');
  `)
  return db
}

function createBackfilledMessageDb(): Database.Database {
  const db = createMessageDb()
  db.exec(`
    DELETE FROM message;
    INSERT INTO message (id, sender_id, ts, type, content) VALUES
      (1, 1, 300, 0, 'newer-first'),
      (2, 1, 400, 0, 'newest-first'),
      (3, 1, 100, 0, 'oldest-backfill'),
      (4, 1, 200, 0, 'older-backfill');
  `)
  return db
}

describe('message pagination', () => {
  it('returns chronological pages and accurate hasMore flags', async () => {
    const db = createMessageDb()
    try {
      const executor = createSqliteExecutor(db)
      const before = await fetchMessagesBefore(executor, 6, 2)
      const after = await fetchMessagesAfter(executor, 1, 10)

      assert.deepEqual(
        before.messages.map((message) => message.id),
        [4, 5]
      )
      assert.equal(before.hasMore, true)
      assert.deepEqual(
        after.messages.map((message) => message.id),
        [2, 3, 4, 5, 6]
      )
      assert.equal(after.hasMore, false)
    } finally {
      db.close()
    }
  })

  it('uses timestamp and id cursors after historical backfill', async () => {
    const db = createBackfilledMessageDb()
    try {
      const executor = createSqliteExecutor(db)
      const before = await fetchMessagesBefore(executor, 1, 10)
      const after = await fetchMessagesAfter(executor, 1, 10)

      assert.deepEqual(
        before.messages.map((message) => message.id),
        [3, 4]
      )
      assert.deepEqual(
        after.messages.map((message) => message.id),
        [2]
      )
    } finally {
      db.close()
    }
  })
})

describe('message search and context', () => {
  it('searches the database and returns the matching total', async () => {
    const db = createMessageDb()
    try {
      const result = await searchMessagesLikeAsync(createSqliteExecutor(db), ['hello'], undefined, 2, 0)

      assert.equal(result.total, 4)
      assert.deepEqual(
        result.messages.map((message) => message.id),
        [6, 4]
      )
    } finally {
      db.close()
    }
  })

  it('loads chronological context instead of insertion order', async () => {
    const db = createBackfilledMessageDb()
    try {
      const adapter = new SqliteTestAdapter(db)
      const executor = createSqliteExecutor(db)
      for (const messages of [getMessageContext(adapter, [1], 2), await fetchMessageContext(executor, 1, 2)]) {
        assert.deepEqual(
          messages.map((message) => message.id),
          [3, 4, 1, 2]
        )
      }
      db.exec(`INSERT INTO message (id, sender_id, ts, type, content) VALUES
        (5, 1, 300, 0, 'same-second backfill'), (6, 1, 300, 0, 'same-second later');`)
      for (const messages of [getMessageContext(adapter, [5], 1), await fetchMessageContext(executor, 5, 1)]) {
        assert.deepEqual(
          messages.map((message) => message.id),
          [1, 5, 6]
        )
      }
    } finally {
      db.close()
    }
  })

  it('falls back to chronological neighbors without a message_context table', async () => {
    const db = createMessageDb()
    try {
      const result = await fetchSearchMessageContext(createSqliteExecutor(db), [3], 1, 1)
      assert.deepEqual(
        result.map((message) => message.id),
        [2, 3, 4]
      )
    } finally {
      db.close()
    }
  })

  for (const indexed of [false, true]) {
    it(`loads backfilled search context in time order and respects segments (indexed=${indexed})`, async () => {
      const db = createBackfilledMessageDb()
      try {
        db.exec(`INSERT INTO message (id, sender_id, ts, type, content) VALUES
          (5, 1, 300, 0, 'same-second backfill'), (6, 1, 300, 0, 'same-second later'),
          (7, 1, 5000, 0, 'another segment');`)
        if (indexed) {
          db.exec(`CREATE TABLE message_context (message_id INTEGER PRIMARY KEY, segment_id INTEGER);
            INSERT INTO message_context SELECT id, CASE WHEN id = 7 THEN 2 ELSE 1 END FROM message;`)
        }
        const adapter = new SqliteTestAdapter(db)
        const executor = createSqliteExecutor(db)
        for (const { ids, before, after, expected } of [
          { ids: [1], before: 1, after: 1, expected: [4, 1, 5] },
          { ids: [5], before: 1, after: 1, expected: [1, 5, 6] },
          { ids: [6], before: 1, after: 1, expected: [5, 6, 2] },
          { ids: [2], before: 1, after: 1, expected: indexed ? [6, 2] : [6, 2, 7] },
          { ids: [1, 5], before: 1, after: 1, expected: [4, 1, 5, 6] },
          { ids: [1], before: 0, after: 1, expected: [1, 5] },
        ]) {
          for (const messages of [
            getSearchMessageContext(adapter, ids, before, after),
            await fetchSearchMessageContext(executor, ids, before, after),
          ]) {
            assert.deepEqual(
              messages.map((message) => message.id),
              expected
            )
          }
        }
      } finally {
        db.close()
      }
    })
  }
})

describe('recent messages', () => {
  it('returns all message types in chronological order', async () => {
    const db = createMessageDb()
    try {
      const result = await fetchAllRecentMessages(createSqliteExecutor(db), undefined, 3)

      assert.equal(result.total, 6)
      assert.deepEqual(
        result.messages.map((message) => message.id),
        [4, 5, 6]
      )
    } finally {
      db.close()
    }
  })

  it('returns only non-system text messages for AI use', async () => {
    const db = createMessageDb()
    try {
      const result = await fetchRecentTextMessages(createSqliteExecutor(db), undefined, 10)

      assert.equal(result.total, 4)
      assert.deepEqual(
        result.messages.map((message) => message.id),
        [1, 3, 5, 6]
      )
    } finally {
      db.close()
    }
  })
})

describe('fetchConversationBetween', () => {
  it('returns an empty result when either member is absent', async () => {
    const db = createMessageDb()
    try {
      const result = await fetchConversationBetween(createSqliteExecutor(db), 1, 404)
      assert.deepEqual(result, { messages: [], total: 0, member1Name: '', member2Name: '' })
    } finally {
      db.close()
    }
  })

  it('returns named conversation data for both members', async () => {
    const db = createMessageDb()
    try {
      const result = await fetchConversationBetween(createSqliteExecutor(db), 1, 2)

      assert.equal(result.total, 5)
      assert.deepEqual([result.member1Name, result.member2Name], ['A', 'Bob'])
      assert.deepEqual(
        result.messages.map((message) => message.id),
        [1, 2, 3, 5, 6]
      )
    } finally {
      db.close()
    }
  })
})
