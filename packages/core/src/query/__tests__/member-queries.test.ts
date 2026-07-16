/**
 * Tests for member query functions: getMembersWithAliases, getMembersPaginated.
 *
 * Covers:
 * - aliases/avatar column existence vs. absence
 * - pagination, search, asc/desc sort
 * - system message member filtering
 *
 * Run: npx tsx --test packages/core/src/query/__tests__/member-queries.test.ts
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getMemberNameHistory, getMembersWithAliases, getMembersPaginated } from '../message-queries'
import type { DatabaseAdapter, PreparedStatement } from '../../interfaces'

// ==================== Mock helpers ====================

interface MockMember {
  id: number
  platformId: string
  accountName: string | null
  groupNickname: string | null
  aliases: string | null
  avatar: string | null
  messageCount: number
  lastMessageTs: number | null
}

const SAMPLE_MEMBERS: MockMember[] = [
  {
    id: 1,
    platformId: 'u1',
    accountName: 'Alice',
    groupNickname: 'A',
    aliases: '["小A"]',
    avatar: 'data:img1',
    messageCount: 100,
    lastMessageTs: 3000,
  },
  {
    id: 2,
    platformId: 'u2',
    accountName: 'Bob',
    groupNickname: null,
    aliases: '[]',
    avatar: null,
    messageCount: 50,
    lastMessageTs: 2000,
  },
  {
    id: 3,
    platformId: 'u3',
    accountName: 'Carol',
    groupNickname: 'C',
    aliases: null,
    avatar: 'data:img3',
    messageCount: 0,
    lastMessageTs: null,
  },
  {
    id: 4,
    platformId: 'sys',
    accountName: '系统消息',
    groupNickname: '系统消息',
    aliases: null,
    avatar: null,
    messageCount: 999,
    lastMessageTs: null,
  },
]

function createMockDb(
  opts: { hasAliases?: boolean; hasAvatar?: boolean; onPrepare?: (sql: string) => void } = {}
): DatabaseAdapter {
  const { hasAliases = true, hasAvatar = true, onPrepare } = opts

  const nonSystemMembers = SAMPLE_MEMBERS.filter((m) => {
    const displayName = m.groupNickname || m.accountName || m.platformId
    return displayName !== '系统消息'
  })

  return {
    prepare(sql: string): PreparedStatement {
      onPrepare?.(sql)
      return {
        get(...params: unknown[]) {
          if (sql.includes('PRAGMA table_info')) {
            return undefined
          }
          if (sql.includes('COUNT(*)')) {
            const searchParam = params.find((p) => typeof p === 'string' && (p as string).includes('%'))
            let filtered = nonSystemMembers
            if (searchParam) {
              const term = (searchParam as string).replace(/%/g, '').toLowerCase()
              filtered = filtered.filter(
                (m) =>
                  m.accountName?.toLowerCase().includes(term) ||
                  m.groupNickname?.toLowerCase().includes(term) ||
                  m.platformId.toLowerCase().includes(term) ||
                  (hasAliases && m.aliases?.toLowerCase().includes(term))
              )
            }
            return { total: filtered.length }
          }
          return undefined
        },
        all(...params: unknown[]) {
          if (sql.includes('PRAGMA table_info')) {
            const cols = [{ name: 'id' }, { name: 'platform_id' }, { name: 'account_name' }, { name: 'group_nickname' }]
            if (sql.includes('member')) {
              if (hasAliases) cols.push({ name: 'aliases' })
              if (hasAvatar) cols.push({ name: 'avatar' })
            }
            return cols
          }

          let filtered = nonSystemMembers

          const searchParam = params.find((p) => typeof p === 'string' && (p as string).includes('%'))
          if (searchParam) {
            const term = (searchParam as string).replace(/%/g, '').toLowerCase()
            filtered = filtered.filter(
              (m) =>
                m.accountName?.toLowerCase().includes(term) ||
                m.groupNickname?.toLowerCase().includes(term) ||
                m.platformId.toLowerCase().includes(term) ||
                (hasAliases && m.aliases?.toLowerCase().includes(term))
            )
          }

          if (sql.includes('ORDER BY messageCount ASC')) {
            filtered = [...filtered].sort((a, b) => a.messageCount - b.messageCount)
          } else {
            filtered = [...filtered].sort((a, b) => b.messageCount - a.messageCount)
          }

          const limitIdx = params.findIndex((_, i) => {
            const remaining = params.slice(i)
            return remaining.length >= 2 && typeof remaining[0] === 'number' && typeof remaining[1] === 'number'
          })
          if (limitIdx >= 0) {
            const limit = params[limitIdx] as number
            const offset = params[limitIdx + 1] as number
            filtered = filtered.slice(offset, offset + limit)
          }

          return filtered.map((m) => ({
            id: m.id,
            platformId: m.platformId,
            accountName: m.accountName,
            groupNickname: m.groupNickname,
            aliases: hasAliases ? m.aliases : null,
            avatar: hasAvatar ? m.avatar : null,
            messageCount: m.messageCount,
            lastMessageTs: m.lastMessageTs,
          }))
        },
        run() {
          return { changes: 0, lastInsertRowid: 0 }
        },
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    exec() {},
    transaction<T>(fn: () => T) {
      return fn()
    },
    pragma() {
      return undefined
    },
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    close() {},
  }
}

function createNameHistoryDb(opts: {
  hasHistoryTable: boolean
  historyRows?: Record<string, unknown>[]
}): DatabaseAdapter {
  return {
    prepare(sql: string): PreparedStatement {
      return {
        get(...params: unknown[]) {
          if (sql.includes('sqlite_master') && params.includes('member_name_history')) {
            return { cnt: opts.hasHistoryTable ? 1 : 0 }
          }
          return undefined
        },
        all() {
          if (sql.includes('FROM member_name_history')) {
            return opts.historyRows ?? []
          }
          if (sql.includes('FROM message')) {
            return [
              { accountName: 'Alice', groupNickname: 'A', startTs: 1000, endTs: 1500 },
              { accountName: 'Alice Chen', groupNickname: null, startTs: 2000, endTs: 2500 },
            ]
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

// ==================== getMembersWithAliases ====================

describe('getMembersWithAliases', () => {
  it('returns members with parsed aliases and avatar', () => {
    const db = createMockDb({ hasAliases: true, hasAvatar: true })
    const result = getMembersWithAliases(db)

    assert.equal(result.length, 3, 'should exclude system message member')
    assert.deepEqual(result[0].aliases, ['小A'])
    assert.equal(result[0].avatar, 'data:img1')
    assert.equal(result[0].accountName, 'Alice')
    assert.equal(result[0].messageCount, 100)
    assert.equal(result[0].lastMessageTs, 3000)
    assert.equal(result.at(-1)?.lastMessageTs, null)
  })

  it('returns empty aliases and null avatar when columns do not exist', () => {
    const db = createMockDb({ hasAliases: false, hasAvatar: false })
    const result = getMembersWithAliases(db)

    assert.equal(result.length, 3)
    for (const m of result) {
      assert.deepEqual(m.aliases, [], 'aliases should default to empty array')
      assert.equal(m.avatar, null, 'avatar should default to null')
    }
  })

  it('excludes system message members', () => {
    const db = createMockDb()
    const result = getMembersWithAliases(db)
    const hasSys = result.some((m) => m.accountName === '系统消息')
    assert.equal(hasSys, false)
  })

  it('sorts by messageCount descending', () => {
    const db = createMockDb()
    const result = getMembersWithAliases(db)
    for (let i = 1; i < result.length; i++) {
      assert.ok(result[i - 1].messageCount >= result[i].messageCount)
    }
  })

  it('adds a deterministic member id tie-breaker to full-list ordering', () => {
    const preparedSql: string[] = []
    const db = createMockDb({ onPrepare: (sql) => preparedSql.push(sql) })

    getMembersWithAliases(db)

    const listSql = preparedSql.find((sql) => sql.includes('ORDER BY messageCount'))
    assert.match(listSql ?? '', /ORDER BY messageCount DESC,\s*m\.id ASC/)
  })

  it('loads the latest message timestamp in the member aggregation', () => {
    const preparedSql: string[] = []
    const db = createMockDb({ onPrepare: (sql) => preparedSql.push(sql) })

    getMembersWithAliases(db)

    const listSql = preparedSql.find((sql) => sql.includes('COUNT(msg.id) as messageCount'))
    assert.match(listSql ?? '', /MAX\(msg\.ts\) as lastMessageTs/)
  })
})

// ==================== getMemberNameHistory ====================

describe('getMemberNameHistory', () => {
  it('derives history from message rows when member_name_history table is absent', () => {
    const result = getMemberNameHistory(createNameHistoryDb({ hasHistoryTable: false }), 1)

    assert.deepEqual(result, [
      { nameType: 'account_name', name: 'Alice', startTs: 1000, endTs: 1500 },
      { nameType: 'group_nickname', name: 'A', startTs: 1000, endTs: 1500 },
      { nameType: 'account_name', name: 'Alice Chen', startTs: 2000, endTs: 2500 },
    ])
  })

  it('derives history from message rows when member_name_history table is empty', () => {
    const result = getMemberNameHistory(createNameHistoryDb({ hasHistoryTable: true, historyRows: [] }), 1)

    assert.deepEqual(result, [
      { nameType: 'account_name', name: 'Alice', startTs: 1000, endTs: 1500 },
      { nameType: 'group_nickname', name: 'A', startTs: 1000, endTs: 1500 },
      { nameType: 'account_name', name: 'Alice Chen', startTs: 2000, endTs: 2500 },
    ])
  })
})

// ==================== getMembersPaginated ====================

describe('getMembersPaginated', () => {
  it('returns first page with correct pagination meta', () => {
    const db = createMockDb()
    const result = getMembersPaginated(db, { page: 1, pageSize: 2 })

    assert.equal(result.page, 1)
    assert.equal(result.pageSize, 2)
    assert.equal(result.total, 3)
    assert.equal(result.totalPages, 2)
    assert.equal(result.members.length, 2)
  })

  it('returns second page', () => {
    const db = createMockDb()
    const result = getMembersPaginated(db, { page: 2, pageSize: 2 })

    assert.equal(result.page, 2)
    assert.equal(result.members.length, 1)
  })

  it('filters by search term', () => {
    const db = createMockDb()
    const result = getMembersPaginated(db, { search: 'alice' })

    assert.equal(result.total, 1)
    assert.equal(result.members[0].accountName, 'Alice')
  })

  it('sorts ascending', () => {
    const db = createMockDb()
    const result = getMembersPaginated(db, { sortOrder: 'asc' })

    for (let i = 1; i < result.members.length; i++) {
      assert.ok(result.members[i - 1].messageCount <= result.members[i].messageCount)
    }
  })

  it('sorts descending by default', () => {
    const db = createMockDb()
    const result = getMembersPaginated(db, {})

    for (let i = 1; i < result.members.length; i++) {
      assert.ok(result.members[i - 1].messageCount >= result.members[i].messageCount)
    }
  })

  it('adds a deterministic member id tie-breaker to paginated ordering', () => {
    const preparedSql: string[] = []
    const db = createMockDb({ onPrepare: (sql) => preparedSql.push(sql) })

    getMembersPaginated(db, { sortOrder: 'desc' })

    const listSql = preparedSql.find((sql) => sql.includes('ORDER BY messageCount'))
    assert.match(listSql ?? '', /ORDER BY messageCount DESC,\s*m\.id ASC/)
  })

  it('includes the latest message timestamp in paginated results', () => {
    const preparedSql: string[] = []
    const db = createMockDb({ onPrepare: (sql) => preparedSql.push(sql) })

    const result = getMembersPaginated(db, {})

    const listSql = preparedSql.find((sql) => sql.includes('LIMIT ? OFFSET ?'))
    assert.match(listSql ?? '', /MAX\(msg\.ts\) as lastMessageTs/)
    assert.equal(result.members[0].lastMessageTs, 3000)
  })

  it('works when aliases/avatar columns are missing', () => {
    const db = createMockDb({ hasAliases: false, hasAvatar: false })
    const result = getMembersPaginated(db, {})

    assert.equal(result.total, 3)
    for (const m of result.members) {
      assert.deepEqual(m.aliases, [])
      assert.equal(m.avatar, null)
    }
  })

  it('uses default page and pageSize when omitted', () => {
    const db = createMockDb()
    const result = getMembersPaginated(db, {})

    assert.equal(result.page, 1)
    assert.equal(result.pageSize, 20)
  })

  it('clamps page to minimum 1', () => {
    const db = createMockDb()
    const result = getMembersPaginated(db, { page: -5 })

    assert.equal(result.page, 1)
  })

  it('clamps pageSize to range [1, 100]', () => {
    const db = createMockDb()
    const r1 = getMembersPaginated(db, { pageSize: 0 })
    assert.equal(r1.pageSize, 1)

    const r2 = getMembersPaginated(db, { pageSize: 999 })
    assert.equal(r2.pageSize, 100)
  })

  it('excludes system message members', () => {
    const db = createMockDb()
    const result = getMembersPaginated(db, { pageSize: 100 })
    const hasSys = result.members.some((m) => m.accountName === '系统消息')
    assert.equal(hasSys, false)
  })
})
