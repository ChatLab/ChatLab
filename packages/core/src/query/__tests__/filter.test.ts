/**
 * Tests for shared filter algorithms (filterMessagesWithContext, getMultipleSessionsMessages).
 *
 * Uses a mock DatabaseAdapter to verify the filtering, context expansion,
 * range merging, and pagination logic.
 *
 * Run: npx tsx --test packages/core/src/query/__tests__/filter.test.ts
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { DatabaseAdapter, PreparedStatement, RunResult } from '../../interfaces/database-adapter'
import type { FullMessageRow } from '../message-sql'
import { filterMessagesWithContext, getMultipleSessionsMessages } from '../filter'

function makeRow(id: number, content: string, ts: number, senderId: number = 1): FullMessageRow {
  return {
    id,
    senderId,
    senderName: `User${senderId}`,
    senderPlatformId: `u${senderId}`,
    aliasesJson: '[]',
    senderAvatar: null,
    content,
    timestamp: ts,
    type: 0,
    replyToMessageId: null,
    replyToContent: null,
    replyToSenderName: null,
  }
}

type LightRow = { id: number; ts: number; senderId: number; content: string | null }

function createMockDb(lightRows: LightRow[], fullRows: FullMessageRow[]): DatabaseAdapter {
  let callCount = 0
  return {
    exec() {
      /* no-op for test */
    },
    prepare(): PreparedStatement {
      callCount++
      const isLightQuery = callCount === 1
      return {
        get(): Record<string, unknown> | undefined {
          return undefined
        },
        all(..._params: unknown[]): Record<string, unknown>[] {
          if (isLightQuery) {
            return lightRows as unknown as Record<string, unknown>[]
          }
          const limit =
            typeof _params[_params.length - 2] === 'number' ? (_params[_params.length - 2] as number) : fullRows.length
          const offset = typeof _params[_params.length - 1] === 'number' ? (_params[_params.length - 1] as number) : 0
          return fullRows.slice(offset, offset + limit) as unknown as Record<string, unknown>[]
        },
        run(): RunResult {
          return { changes: 0 }
        },
      }
    },
    transaction<T>(fn: () => T): T {
      return fn()
    },
    pragma() {
      return undefined
    },
    close() {
      /* no-op for test */
    },
  }
}

describe('filterMessagesWithContext', () => {
  it('returns empty result when no messages match', () => {
    const lightRows: LightRow[] = [
      { id: 1, ts: 100, senderId: 1, content: 'hello' },
      { id: 2, ts: 200, senderId: 2, content: 'world' },
    ]
    const db = createMockDb(lightRows, [])
    const result = filterMessagesWithContext(db, { keywords: ['notfound'] })
    assert.equal(result.blocks.length, 0)
    assert.equal(result.stats.hitMessages, 0)
    assert.equal(result.pagination.totalHits, 0)
  })

  it('matches keywords case-insensitively', () => {
    const lightRows: LightRow[] = [
      { id: 1, ts: 100, senderId: 1, content: 'Hello World' },
      { id: 2, ts: 200, senderId: 2, content: 'foo bar' },
    ]
    const fullRows = [makeRow(1, 'Hello World', 100)]
    const db = createMockDb(lightRows, fullRows)
    const result = filterMessagesWithContext(db, { keywords: ['hello'], contextSize: 0 })
    assert.equal(result.pagination.totalHits, 1)
    assert.equal(result.blocks.length, 1)
    assert.equal(result.blocks[0].messages[0].isHit, true)
  })

  it('filters by sender IDs', () => {
    const lightRows: LightRow[] = [
      { id: 1, ts: 100, senderId: 1, content: 'msg1' },
      { id: 2, ts: 200, senderId: 2, content: 'msg2' },
      { id: 3, ts: 300, senderId: 1, content: 'msg3' },
    ]
    const fullRows = [makeRow(1, 'msg1', 100, 1), makeRow(3, 'msg3', 300, 1)]
    const db = createMockDb(lightRows, fullRows)
    const result = filterMessagesWithContext(db, { senderIds: [1], contextSize: 0 })
    assert.equal(result.pagination.totalHits, 2)
  })

  it('merges overlapping context ranges', () => {
    const lightRows: LightRow[] = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      ts: (i + 1) * 100,
      senderId: 1,
      content: i === 2 || i === 4 ? 'MATCH' : 'other',
    }))
    const fullRows = lightRows.map((r) => makeRow(r.id, r.content ?? '', r.ts))
    const db = createMockDb(lightRows, fullRows)
    const result = filterMessagesWithContext(db, { keywords: ['match'], contextSize: 2 })
    assert.equal(result.pagination.totalHits, 2)
    assert.equal(result.blocks.length, 1, 'adjacent hits should merge into one block')
  })

  it('paginates blocks correctly', () => {
    const lightRows: LightRow[] = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      ts: (i + 1) * 100,
      senderId: 1,
      content: i % 20 === 0 ? 'HIT' : 'other',
    }))
    const fullRows = lightRows.map((r) => makeRow(r.id, r.content ?? '', r.ts))
    const db = createMockDb(lightRows, fullRows)
    const result = filterMessagesWithContext(db, { keywords: ['hit'], contextSize: 0, pageSize: 2, page: 1 })
    assert.equal(result.blocks.length, 2)
    assert.equal(result.pagination.hasMore, true)
    assert.equal(result.pagination.totalBlocks, 5)
  })
})

describe('getMultipleSessionsMessages', () => {
  it('returns empty result for empty segmentIds', () => {
    const db = createMockDb([], [])
    const result = getMultipleSessionsMessages(db, [])
    assert.equal(result.blocks.length, 0)
  })
})
