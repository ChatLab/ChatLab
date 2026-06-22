/**
 * Minimal tests for shared async message query functions.
 *
 * Verifies that both "Electron-style" (sync-backed) and "Web-style" (async-backed)
 * executors call the same core functions and produce consistent results.
 *
 * Run: npx tsx --test packages/core/src/query/__tests__/message-query-functions.test.ts
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { AsyncSqlExecutor } from '../message-query-functions'
import type { FullMessageRow } from '../message-sql'
import {
  fetchMessagesBefore,
  fetchMessagesAfter,
  searchMessagesLikeAsync,
  fetchMessageContext,
  fetchSearchMessageContext,
  fetchAllRecentMessages,
  fetchRecentTextMessages,
  fetchConversationBetween,
} from '../message-query-functions'

// ==================== Test fixtures ====================

function makeRow(id: number, content: string = `msg-${id}`, ts?: number): FullMessageRow {
  return {
    id,
    senderId: 1,
    senderName: 'Alice',
    senderPlatformId: 'alice_001',
    aliasesJson: '[]',
    senderAvatar: null,
    content,
    timestamp: ts ?? 1700000000 + id * 60,
    type: 0,
    replyToMessageId: null,
    replyToContent: null,
    replyToSenderName: null,
  }
}

const SAMPLE_ROWS: FullMessageRow[] = Array.from({ length: 10 }, (_, i) => makeRow(i + 1))

// ==================== Mock executors ====================

function extractQueryKey(sql: string): string {
  const t = sql.trim().toLowerCase()
  if (t.includes('count(*)')) return 'count'
  if (t.includes('sqlite_master')) return 'sqlite_master'
  if (t.includes('from message_context mc')) return 'session_context'
  if (t.includes('from message_context')) return 'message_context'
  if (t.includes('from member')) return 'member'
  if (t.includes('msg.id in')) return 'by_ids'
  if (t.includes('msg.id <') || (t.includes('id <') && t.includes('order by') && t.includes('desc'))) return 'before'
  if (t.includes('msg.id >') || (t.includes('id >') && t.includes('order by') && t.includes('asc'))) return 'after'
  if (t.includes('order by msg.ts desc')) return 'desc'
  return 'default'
}

/** Simulates Electron-style executor (sync-backed, wraps result in Promise.resolve). */
function createSyncBackedExecutor(store: Map<string, unknown[]>): AsyncSqlExecutor {
  return {
    all<T>(sql: string, _params: unknown[] = []): Promise<T[]> {
      return Promise.resolve((store.get(extractQueryKey(sql)) ?? []) as T[])
    },
    get<T>(sql: string, _params: unknown[] = []): Promise<T | undefined> {
      const rows = (store.get(extractQueryKey(sql)) ?? []) as T[]
      return Promise.resolve(rows[0])
    },
  }
}

/** Simulates Web-style executor (truly async, like pluginQuery over HTTP). */
function createAsyncExecutor(store: Map<string, unknown[]>): AsyncSqlExecutor {
  return {
    async all<T>(sql: string, _params: unknown[] = []): Promise<T[]> {
      await new Promise((r) => setTimeout(r, 1))
      return (store.get(extractQueryKey(sql)) ?? []) as T[]
    },
    async get<T>(sql: string, _params: unknown[] = []): Promise<T | undefined> {
      await new Promise((r) => setTimeout(r, 1))
      const rows = (store.get(extractQueryKey(sql)) ?? []) as T[]
      return rows[0]
    },
  }
}

// ==================== Tests ====================

describe('fetchMessagesBefore', () => {
  it('returns messages in ascending order with hasMore flag', async () => {
    const rows = SAMPLE_ROWS.slice(0, 4)
    const store = new Map<string, unknown[]>([['before', rows]])

    const syncResult = await fetchMessagesBefore(createSyncBackedExecutor(store), 10, 3)
    const asyncResult = await fetchMessagesBefore(createAsyncExecutor(store), 10, 3)

    assert.equal(syncResult.hasMore, true)
    assert.equal(asyncResult.hasMore, true)
    assert.equal(syncResult.messages.length, 3)
    assert.equal(asyncResult.messages.length, 3)
    assert.deepEqual(
      syncResult.messages.map((m) => m.id),
      asyncResult.messages.map((m) => m.id)
    )
  })

  it('returns hasMore=false when fewer results than limit+1', async () => {
    const rows = SAMPLE_ROWS.slice(0, 2)
    const store = new Map<string, unknown[]>([['before', rows]])

    const result = await fetchMessagesBefore(createSyncBackedExecutor(store), 10, 5)
    assert.equal(result.hasMore, false)
    assert.equal(result.messages.length, 2)
  })
})

describe('fetchMessagesAfter', () => {
  it('returns messages with hasMore flag, consistent across executors', async () => {
    const rows = SAMPLE_ROWS.slice(5, 10)
    const store = new Map<string, unknown[]>([['after', rows]])

    const syncResult = await fetchMessagesAfter(createSyncBackedExecutor(store), 5, 4)
    const asyncResult = await fetchMessagesAfter(createAsyncExecutor(store), 5, 4)

    assert.equal(syncResult.hasMore, true)
    assert.equal(asyncResult.hasMore, true)
    assert.equal(syncResult.messages.length, 4)
    assert.deepEqual(
      syncResult.messages.map((m) => m.id),
      asyncResult.messages.map((m) => m.id)
    )
  })
})

describe('searchMessagesLikeAsync', () => {
  it('returns total and messages consistently across executors', async () => {
    const store = new Map<string, unknown[]>([
      ['count', [{ total: 42 }]],
      ['desc', SAMPLE_ROWS.slice(0, 5)],
    ])

    const syncResult = await searchMessagesLikeAsync(createSyncBackedExecutor(store), ['hello'], undefined, 20, 0)
    const asyncResult = await searchMessagesLikeAsync(createAsyncExecutor(store), ['hello'], undefined, 20, 0)

    assert.equal(syncResult.total, 42)
    assert.equal(asyncResult.total, 42)
    assert.equal(syncResult.messages.length, asyncResult.messages.length)
  })
})

describe('fetchMessageContext', () => {
  it('collects context ids around target messages', async () => {
    const store = new Map<string, unknown[]>([
      ['before', [{ id: 4 }, { id: 3 }]],
      ['after', [{ id: 6 }, { id: 7 }]],
      ['by_ids', [makeRow(3), makeRow(4), makeRow(5), makeRow(6), makeRow(7)]],
    ])

    const syncResult = await fetchMessageContext(createSyncBackedExecutor(store), 5, 2)
    const asyncResult = await fetchMessageContext(createAsyncExecutor(store), 5, 2)

    assert.equal(syncResult.length, asyncResult.length)
    assert.deepEqual(
      syncResult.map((m) => m.id),
      asyncResult.map((m) => m.id)
    )
  })
})

describe('fetchAllRecentMessages', () => {
  it('returns total and messages in ascending order', async () => {
    const rows = SAMPLE_ROWS.slice(0, 3)
    const store = new Map<string, unknown[]>([
      ['count', [{ total: 100 }]],
      ['desc', rows],
    ])

    const syncResult = await fetchAllRecentMessages(createSyncBackedExecutor(store), undefined, 3)
    const asyncResult = await fetchAllRecentMessages(createAsyncExecutor(store), undefined, 3)

    assert.equal(syncResult.total, 100)
    assert.equal(asyncResult.total, 100)
    assert.equal(syncResult.messages.length, 3)
    assert.deepEqual(
      syncResult.messages.map((m) => m.id),
      asyncResult.messages.map((m) => m.id)
    )
  })
})

describe('fetchRecentTextMessages', () => {
  it('returns total and messages from sync and async executors', async () => {
    const rows = SAMPLE_ROWS.slice(0, 2)
    const store = new Map<string, unknown[]>([
      ['count', [{ total: 50 }]],
      ['desc', rows],
    ])

    const syncResult = await fetchRecentTextMessages(createSyncBackedExecutor(store), undefined, 10)
    const asyncResult = await fetchRecentTextMessages(createAsyncExecutor(store), undefined, 10)

    assert.equal(syncResult.total, 50)
    assert.equal(asyncResult.total, 50)
    assert.deepEqual(
      syncResult.messages.map((m) => m.id),
      asyncResult.messages.map((m) => m.id)
    )
  })
})

describe('fetchConversationBetween', () => {
  it('returns empty when member not found', async () => {
    const store = new Map<string, unknown[]>()
    const result = await fetchConversationBetween(createSyncBackedExecutor(store), 1, 2)
    assert.equal(result.messages.length, 0)
    assert.equal(result.member1Name, '')
    assert.equal(result.member2Name, '')
  })

  it('returns conversation data when both members exist', async () => {
    const rows = [makeRow(10, 'hi', 1700000000), makeRow(11, 'hello', 1700000060)]
    const store = new Map<string, unknown[]>([
      ['member', [{ name: 'Alice' }]],
      ['count', [{ total: 2 }]],
      ['desc', rows],
    ])

    const syncResult = await fetchConversationBetween(createSyncBackedExecutor(store), 1, 2)
    const asyncResult = await fetchConversationBetween(createAsyncExecutor(store), 1, 2)

    assert.equal(syncResult.total, 2)
    assert.equal(asyncResult.total, 2)
    assert.equal(syncResult.member1Name, 'Alice')
    assert.equal(asyncResult.member1Name, 'Alice')
  })
})

describe('fetchSearchMessageContext', () => {
  it('falls back to id-based context when no message_context table', async () => {
    const store = new Map<string, unknown[]>([
      ['before', [{ id: 4 }]],
      ['after', [{ id: 6 }]],
      ['by_ids', [makeRow(4), makeRow(5), makeRow(6)]],
    ])

    const result = await fetchSearchMessageContext(createSyncBackedExecutor(store), [5], 1, 1)
    assert.ok(result.length > 0)
  })
})
