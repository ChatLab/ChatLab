/**
 * Tests for keyword search routing between the FTS5 trigram index and LIKE.
 *
 * Switching the index on must not change which messages a user finds: the same
 * fixture is searched both ways and the hit sets are compared. Also guards the
 * cases where the index cannot be used — keywords below the trigram floor,
 * `forceLike`, a database with no index at all — and the relevance ordering the
 * AI search tool relies on.
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type Database from 'better-sqlite3'
import { CHAT_DB_TABLES } from '../schema/tables'
import { searchMessagesByKeywords, searchMessagesLike } from './message-queries'
import { searchMessagesLikeAsync } from './message-query-functions'
import { ensureMessageSearchIndex } from './search-index'
import { SqliteTestAdapter } from './__tests__/sqlite-test-adapter'
import { openTestSqliteDatabase } from '../../../../tests/helpers/sqlite.mts'

/**
 * A corpus wide enough that FTS and LIKE can disagree: repeated keywords, mixed
 * scripts, ASCII case variants, punctuation, and messages that contain one
 * keyword but not the other.
 */
const CORPUS = [
  '今天天气不错，我们出去玩吧',
  '周末有人一起打球吗？地点老地方',
  '老地方见，打球打球打球，今天打球三次',
  '天气不错，适合打球',
  'weekend project meeting at the old place',
  'WEEKEND Project sync',
  'a mixed message 和中文混排 about the weekend',
  '收到，明天见',
  '[图片]',
  '打球',
  '说了句 "老地方" 就走了',
  'nothing relevant here at all',
]

function seed(raw: Database.Database): void {
  raw.exec(CHAT_DB_TABLES)
  raw.prepare(`INSERT INTO member (id, platform_id, account_name) VALUES (1, 'u1', 'Alice')`).run()
  raw.prepare(`INSERT INTO member (id, platform_id, account_name) VALUES (2, 'u2', '系统消息')`).run()
  const insert = raw.prepare(`INSERT INTO message (id, sender_id, ts, type, content) VALUES (?, ?, ?, 0, ?)`)
  CORPUS.forEach((content, index) => insert.run(index + 1, 1, 1_700_000_000 + index * 60, content))
  // A system message that would match, to keep the systemFilter honest on both paths.
  insert.run(CORPUS.length + 1, 2, 1_700_009_999, '系统提示：老地方已解散')
  // '老槐树' appears only in these two: the oldest message mentions it four times,
  // the newest once, so relevance and timestamp order disagree about the top hit.
  insert.run(14, 1, 1_699_999_000, '老槐树老槐树老槐树，都在老槐树下')
  insert.run(15, 1, 1_700_099_000, '今天路过老槐树')
}

function hitIds(result: { messages: Array<{ id: number }> }): number[] {
  return result.messages.map((message) => message.id).sort((left, right) => left - right)
}

function asyncExecutor(raw: Database.Database) {
  return {
    all: async <T>(sql: string, params: unknown[] = []) => raw.prepare(sql).all(...params) as T[],
    get: async <T>(sql: string, params: unknown[] = []) => raw.prepare(sql).get(...params) as T | undefined,
  }
}

describe('keyword search: FTS index vs LIKE', () => {
  let raw: Database.Database
  let db: SqliteTestAdapter

  before(() => {
    raw = openTestSqliteDatabase()
    db = new SqliteTestAdapter(raw)
    seed(raw)
    ensureMessageSearchIndex(db)
  })

  after(() => raw.close())

  const indexableQueries: Array<{ keywords: string[]; matchMode?: 'any' | 'all' }> = [
    { keywords: ['老地方'] },
    { keywords: ['打球'.repeat(2)] },
    { keywords: ['天气不错'] },
    { keywords: ['weekend'] },
    { keywords: ['project'] },
    { keywords: ['老地方', '打球吗'] },
    { keywords: ['老地方', '打球吗'], matchMode: 'all' },
    { keywords: ['和中文混排'] },
    { keywords: ['"老地方"'] },
    { keywords: ['no such keyword here'] },
  ]

  for (const { keywords, matchMode } of indexableQueries) {
    it(`returns the LIKE hit set for ${JSON.stringify(keywords)} (${matchMode ?? 'any'})`, () => {
      const viaFts = searchMessagesByKeywords(db, keywords, { limit: 100, matchMode })
      const viaLike = searchMessagesByKeywords(db, keywords, { limit: 100, matchMode, forceLike: true })

      assert.equal(viaFts.total, viaLike.total, 'totals must agree')
      // FTS folds case for Unicode where LIKE only folds ASCII, so the index may
      // legitimately return a superset; on this fixture it must not miss anything.
      const ftsIds = new Set(hitIds(viaFts))
      for (const id of hitIds(viaLike)) assert.ok(ftsIds.has(id), `FTS missed message ${id}`)
    })
  }

  it('falls back to LIKE for keywords the trigram tokenizer cannot match', () => {
    // '天气' is two code points: the index holds no trigram for it, so a routed
    // query would silently return nothing.
    const short = searchMessagesByKeywords(db, ['天气'], { limit: 100 })
    const forced = searchMessagesByKeywords(db, ['天气'], { limit: 100, forceLike: true })

    assert.deepEqual(hitIds(short), hitIds(forced))
    assert.deepEqual(hitIds(short), [1, 4])
  })

  it('falls back to LIKE when one keyword of a set is too short', () => {
    const mixed = searchMessagesByKeywords(db, ['老地方', '天气'], { limit: 100 })
    const forced = searchMessagesByKeywords(db, ['老地方', '天气'], { limit: 100, forceLike: true })

    assert.deepEqual(hitIds(mixed), hitIds(forced))
    assert.ok(hitIds(mixed).includes(1), 'the short keyword must still match')
  })

  it('separates any from all', () => {
    const any = searchMessagesByKeywords(db, ['天气不错', '打球吗'], { limit: 100 })
    const all = searchMessagesByKeywords(db, ['天气不错', '打球吗'], { limit: 100, matchMode: 'all' })

    assert.deepEqual(hitIds(any), [1, 2, 4])
    assert.deepEqual(hitIds(all), [])
  })

  it('excludes system messages on both paths', () => {
    const viaFts = searchMessagesByKeywords(db, ['老地方'], { limit: 100 })
    const viaLike = searchMessagesByKeywords(db, ['老地方'], { limit: 100, forceLike: true })

    assert.ok(!hitIds(viaFts).includes(CORPUS.length + 1))
    assert.deepEqual(hitIds(viaFts), hitIds(viaLike))
  })

  it('honors the time window on the indexed path', () => {
    const windowed = searchMessagesByKeywords(db, ['老地方'], { limit: 100, startTs: 0, endTs: 1_700_000_100 })
    assert.deepEqual(hitIds(windowed), [2])
  })

  it('ranks the most-repeated match first with sort: relevance', () => {
    const relevance = searchMessagesByKeywords(db, ['老槐树'], { limit: 100, sort: 'relevance' })
    const recent = searchMessagesByKeywords(db, ['老槐树'], { limit: 100 })

    assert.equal(relevance.messages[0].id, 14, 'the message repeating the keyword ranks first')
    assert.equal(recent.messages[0].id, 15, 'timestamp order puts the newest first instead')
    assert.equal(relevance.total, recent.total)
    assert.deepEqual(hitIds(relevance), hitIds(recent))
  })

  it('ignores sort: relevance when the query cannot use the index', () => {
    const relevance = searchMessagesByKeywords(db, ['打球'], { limit: 100, sort: 'relevance' })
    const recent = searchMessagesByKeywords(db, ['打球'], { limit: 100 })

    assert.deepEqual(
      relevance.messages.map((message) => message.id),
      recent.messages.map((message) => message.id)
    )
  })

  it('escapes quotes in keywords instead of failing the FTS query', () => {
    const quoted = searchMessagesByKeywords(db, ['"老地方"'], { limit: 100 })
    assert.deepEqual(hitIds(quoted), [11])
  })

  it('routes the single-keyword CLI helper through the index and escapes wildcards', () => {
    assert.deepEqual(hitIds(searchMessagesLike(db, '老地方', { limit: 100 })), [2, 3, 11])
    // '%' used to reach LIKE unescaped and match every message.
    assert.equal(searchMessagesLike(db, '100%', { limit: 100 }).total, 0)
  })

  it('gives the async executor path the same hit set as its own LIKE fallback', async () => {
    const executor = asyncExecutor(raw)
    const viaFts = await searchMessagesLikeAsync(executor, ['老地方'], undefined, 100)
    const viaLike = await searchMessagesLikeAsync(executor, ['老地方'], undefined, 100, 0, undefined, {
      forceLike: true,
    })

    // This path has never applied the system-message filter, so id 13 is included
    // by both; what matters is that routing does not change the hit set.
    assert.deepEqual(hitIds(viaFts), hitIds(viaLike))
    assert.deepEqual(hitIds(viaFts), [2, 3, 11, 13])
    assert.equal(viaFts.total, viaLike.total)
  })

  it('ranks by relevance on the async path too', async () => {
    const relevance = await searchMessagesLikeAsync(asyncExecutor(raw), ['老槐树'], undefined, 100, 0, undefined, {
      sort: 'relevance',
    })
    assert.equal(relevance.messages[0].id, 14)
  })
})

describe('keyword search on a database without the index', () => {
  let raw: Database.Database
  let db: SqliteTestAdapter

  before(() => {
    raw = openTestSqliteDatabase()
    db = new SqliteTestAdapter(raw)
    seed(raw)
  })

  after(() => raw.close())

  it('still searches, including with sort: relevance', async () => {
    assert.deepEqual(hitIds(searchMessagesByKeywords(db, ['老地方'], { limit: 100 })), [2, 3, 11])
    assert.deepEqual(hitIds(searchMessagesByKeywords(db, ['老地方'], { limit: 100, sort: 'relevance' })), [2, 3, 11])
    assert.deepEqual(hitIds(searchMessagesLike(db, '老地方', { limit: 100 })), [2, 3, 11])

    const viaAsync = await searchMessagesLikeAsync(asyncExecutor(raw), ['老地方'], undefined, 100, 0, undefined, {
      sort: 'relevance',
    })
    assert.deepEqual(hitIds(viaAsync), [2, 3, 11, 13])
  })
})
