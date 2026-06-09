/**
 * Minimal tests for session query functions.
 *
 * Verifies buildSessionInfo pure mapper and getSessionInfo / getSummaryCount / getLastPlatformMessageId
 * against a mock DatabaseAdapter.
 *
 * Run: npx tsx --test packages/core/src/query/__tests__/session-queries.test.ts
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { SessionMeta, SessionOverview } from '../session-queries'
import {
  buildSessionInfo,
  getChatOverview,
  getSessionInfo,
  getSummaryCount,
  getLastPlatformMessageId,
} from '../session-queries'
import type { DatabaseAdapter } from '../../interfaces'

// ==================== Mock helpers ====================

function makeMeta(overrides?: Partial<SessionMeta>): SessionMeta {
  return {
    name: 'Test Group',
    platform: 'wechat',
    type: 'group',
    importedAt: 1700000000,
    groupId: 'g001',
    groupAvatar: null,
    ownerId: 'u001',
    ...overrides,
  }
}

function makeOverview(overrides?: Partial<SessionOverview>): SessionOverview {
  return {
    totalMessages: 500,
    totalMembers: 10,
    firstMessageTs: 1600000000,
    lastMessageTs: 1700000000,
    ...overrides,
  }
}

type QueryResult = Record<string, unknown>

/**
 * Create a mock DatabaseAdapter whose prepare().get()/all() respond based on SQL patterns.
 */
function createMockDb(handlers: Record<string, (args: unknown[]) => QueryResult | QueryResult[]>): DatabaseAdapter {
  return {
    prepare(sql: string) {
      return {
        get(...args: unknown[]) {
          for (const [pattern, handler] of Object.entries(handlers)) {
            if (sql.includes(pattern)) {
              return handler(args)
            }
          }
          return undefined
        },
        all(...args: unknown[]) {
          for (const [pattern, handler] of Object.entries(handlers)) {
            if (sql.includes(pattern)) {
              const result = handler(args)
              return Array.isArray(result) ? result : [result]
            }
          }
          return []
        },
        run() {
          return { changes: 0, lastInsertRowid: 0 }
        },
      }
    },
  } as unknown as DatabaseAdapter
}

// ==================== Tests ====================

describe('buildSessionInfo', () => {
  it('composes meta + overview into flat CoreSessionInfo', () => {
    const meta = makeMeta()
    const overview = makeOverview()
    const info = buildSessionInfo(meta, overview, 3)

    assert.equal(info.name, 'Test Group')
    assert.equal(info.platform, 'wechat')
    assert.equal(info.type, 'group')
    assert.equal(info.importedAt, 1700000000)
    assert.equal(info.messageCount, 500)
    assert.equal(info.memberCount, 10)
    assert.equal(info.firstMessageTs, 1600000000)
    assert.equal(info.lastMessageTs, 1700000000)
    assert.equal(info.groupId, 'g001')
    assert.equal(info.groupAvatar, null)
    assert.equal(info.ownerId, 'u001')
    assert.equal(info.summaryCount, 3)
  })

  it('defaults summaryCount to 0 when omitted', () => {
    const info = buildSessionInfo(makeMeta(), makeOverview())
    assert.equal(info.summaryCount, 0)
  })

  it('preserves null timestamps when overview has no messages', () => {
    const overview = makeOverview({ firstMessageTs: null, lastMessageTs: null })
    const info = buildSessionInfo(makeMeta(), overview)
    assert.equal(info.firstMessageTs, null)
    assert.equal(info.lastMessageTs, null)
  })
})

describe('getSessionInfo', () => {
  it('returns null when meta table is empty', () => {
    const db = createMockDb({
      'FROM meta': () => undefined as unknown as QueryResult,
    })
    assert.equal(getSessionInfo(db), null)
  })

  it('returns combined CoreSessionInfo from DB', () => {
    const db = createMockDb({
      'FROM meta': () => ({
        name: 'Chat',
        platform: 'telegram',
        type: 'private',
        imported_at: 1700000000,
        group_id: null,
        group_avatar: null,
        owner_id: 'me',
      }),
      'COUNT(*)': () => ({ count: 42 }),
      'MIN(ts)': () => ({ v: 1600000000 }),
      'MAX(ts)': () => ({ v: 1700000000 }),
      sqlite_master: () => ({ cnt: 0 }),
    })

    const info = getSessionInfo(db)
    assert.ok(info)
    assert.equal(info.name, 'Chat')
    assert.equal(info.platform, 'telegram')
    assert.equal(info.type, 'private')
    assert.equal(info.ownerId, 'me')
  })
})

describe('getChatOverview', () => {
  it('returns summaryCount together with overview and top members', () => {
    const db = createMockDb({
      'FROM meta': () => ({
        name: 'Chat',
        platform: 'wechat',
        type: 'group',
        imported_at: 1700000000,
        group_id: null,
        group_avatar: null,
        owner_id: null,
      }),
      'FROM message msg': () => ({ count: 42 }),
      'FROM member\n       WHERE': () => ({ count: 2 }),
      'MIN(ts)': () => ({ v: 1600000000 }),
      'MAX(ts)': () => ({ v: 1700000000 }),
      sqlite_master: () => ({ cnt: 1 }),
      'FROM segment': () => ({ count: 5 }),
      'FROM member m': () => [
        { memberId: 1, platformId: 'u1', name: 'Alice', avatar: null, messageCount: 30 },
        { memberId: 2, platformId: 'u2', name: 'Bob', avatar: null, messageCount: 12 },
      ],
    })

    const overview = getChatOverview(db, 1)

    assert.ok(overview)
    assert.equal(overview.summaryCount, 5)
    assert.deepEqual(overview.topMembers, [{ id: 1, name: 'Alice', count: 30 }])
  })
})

describe('getSummaryCount', () => {
  it('returns 0 when segment table does not exist', () => {
    const db = createMockDb({
      sqlite_master: () => ({ cnt: 0 }),
    })
    assert.equal(getSummaryCount(db), 0)
  })

  it('returns count when segment table exists', () => {
    const db = createMockDb({
      sqlite_master: () => ({ cnt: 1 }),
      'FROM segment': () => ({ count: 7 }),
    })
    assert.equal(getSummaryCount(db), 7)
  })
})

describe('getLastPlatformMessageId', () => {
  it('returns null when no platform_message_id exists', () => {
    const db = createMockDb({
      platform_message_id: () => undefined as unknown as QueryResult,
    })
    assert.equal(getLastPlatformMessageId(db), null)
  })

  it('returns the latest platform_message_id', () => {
    const db = createMockDb({
      platform_message_id: () => ({ platform_message_id: 'pmid-999' }),
    })
    assert.equal(getLastPlatformMessageId(db), 'pmid-999')
  })
})
