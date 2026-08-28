/**
 * Tests for shared social analysis queries and graph helpers.
 *
 * Run: pnpm test -- packages/core/src/query/advanced/__tests__/social.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import Database from 'better-sqlite3'
import {
  accumulateCoOccurrencePairBatches,
  accumulateCoOccurrencePairs,
  getClusterGraph,
  getLaughAnalysis,
  getMentionAnalysis,
} from '../social'
import type { ClusterGraphOptions, CoOccurrenceMessage, CoOccurrencePairStats } from '../social'
import type { DatabaseAdapter, PreparedStatement, RunResult } from '../../../interfaces'

class Statement implements PreparedStatement {
  readonly?: boolean

  constructor(private readonly statement: Database.Statement) {
    this.readonly = statement.readonly
  }

  get(...params: unknown[]) {
    return this.statement.get(...params) as Record<string, unknown> | undefined
  }

  all(...params: unknown[]) {
    return this.statement.all(...params) as Record<string, unknown>[]
  }

  run(...params: unknown[]): RunResult {
    const result = this.statement.run(...params)
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid }
  }
}

class Adapter implements DatabaseAdapter {
  constructor(private readonly database: Database.Database) {}

  exec(sql: string) {
    this.database.exec(sql)
  }

  prepare(sql: string) {
    return new Statement(this.database.prepare(sql))
  }

  transaction<T>(fn: () => T): T {
    return this.database.transaction(fn)()
  }

  pragma(pragma: string) {
    return this.database.pragma(pragma)
  }

  close() {
    this.database.close()
  }
}

function createMentionDatabase(): Adapter {
  const database = new Database(':memory:')
  database.exec(`
    CREATE TABLE member (
      id INTEGER PRIMARY KEY,
      platform_id TEXT,
      account_name TEXT,
      group_nickname TEXT
    );
    CREATE TABLE member_name_history (member_id INTEGER, name TEXT);
    CREATE TABLE message (
      id INTEGER PRIMARY KEY,
      sender_id INTEGER,
      ts INTEGER,
      type INTEGER,
      content TEXT
    );
    INSERT INTO member (id, platform_id, account_name) VALUES
      (1, 'u1', 'Alice'),
      (2, 'u2', 'Bob'),
      (3, 'u3', 'Carol');
    INSERT INTO message (id, sender_id, ts, type, content) VALUES
      (1, 1, 1, 0, '@Bob'),
      (2, 1, 2, 0, '@Bob'),
      (3, 1, 3, 0, '@Bob'),
      (4, 1, 4, 0, '@Carol'),
      (5, 2, 5, 0, '@Alice'),
      (6, 2, 6, 0, '@Alice');
  `)
  return new Adapter(database)
}

function legacyAccumulateCoOccurrencePairs(
  messages: CoOccurrenceMessage[],
  options: ClusterGraphOptions = {}
): CoOccurrencePairStats[] {
  const opts = { lookAhead: 3, decaySeconds: 120, topEdges: 100, ...options }
  const rawScores = new Map<string, number>()
  const counts = new Map<string, number>()
  const latestTimestamps = new Map<string, number>()

  for (let index = 0; index < messages.length - 1; index++) {
    const anchor = messages[index]
    const seenPartners = new Set<number>()
    let partnersFound = 0
    for (let nextIndex = index + 1; nextIndex < messages.length && partnersFound < opts.lookAhead; nextIndex++) {
      const candidate = messages[nextIndex]
      if (candidate.senderId === anchor.senderId || seenPartners.has(candidate.senderId)) continue
      seenPartners.add(candidate.senderId)
      partnersFound++
      const decayWeight = Math.exp(-(candidate.ts - anchor.ts) / opts.decaySeconds)
      const positionWeight = 1 - (partnersFound - 1) * 0.2
      const key =
        anchor.senderId < candidate.senderId
          ? `${anchor.senderId}-${candidate.senderId}`
          : `${candidate.senderId}-${anchor.senderId}`
      rawScores.set(key, (rawScores.get(key) ?? 0) + decayWeight * positionWeight)
      counts.set(key, (counts.get(key) ?? 0) + 1)
      latestTimestamps.set(key, Math.max(latestTimestamps.get(key) ?? 0, candidate.ts))
    }
  }

  return [...rawScores].map(([key, rawScore]) => {
    const [sourceId, targetId] = key.split('-').map(Number)
    return {
      sourceId,
      targetId,
      rawScore,
      coOccurrenceCount: counts.get(key) ?? 0,
      lastOccurrenceTs: latestTimestamps.get(key) ?? 0,
    }
  })
}

describe('social analysis', () => {
  it('returns an empty keyword analysis when no usable keywords are provided', () => {
    const database = createMentionDatabase()

    try {
      const expected = {
        rankByRate: [],
        rankByCount: [],
        typeDistribution: [],
        totalLaughs: 0,
        totalMessages: 0,
        groupLaughRate: 0,
      }
      assert.deepEqual(getLaughAnalysis(database), expected)
      assert.deepEqual(getLaughAnalysis(database, undefined, ['', '   ']), expected)
    } finally {
      database.close()
    }
  })

  it('tracks the latest timestamp for each co-occurrence pair', () => {
    const pairs = accumulateCoOccurrencePairs([
      { senderId: 1, ts: 1704103200 },
      { senderId: 2, ts: 1704103260 },
      { senderId: 1, ts: 1704103320 },
      { senderId: 2, ts: 1704103380 },
      { senderId: 3, ts: 1704107000 },
    ])

    const ownerAlice = pairs.find((pair) => pair.sourceId === 1 && pair.targetId === 2)

    assert.ok(ownerAlice)
    assert.equal(ownerAlice.lastOccurrenceTs, 1704103380)
  })

  it('uses unix seconds directly for co-occurrence decay', () => {
    const closePair = accumulateCoOccurrencePairs(
      [
        { senderId: 1, ts: 1704103200 },
        { senderId: 2, ts: 1704103260 },
      ],
      { decaySeconds: 120 }
    )[0]
    const distantPair = accumulateCoOccurrencePairs(
      [
        { senderId: 1, ts: 1704103200 },
        { senderId: 2, ts: 1704106800 },
      ],
      { decaySeconds: 120 }
    )[0]

    assert.ok(closePair)
    assert.ok(distantPair)
    assert.ok(closePair.rawScore > 0.6)
    assert.ok(distantPair.rawScore < 0.001)
  })

  it('preserves pair order and scores when a look-ahead window crosses batches', () => {
    const messages = [
      { senderId: 4, ts: 100 },
      { senderId: 4, ts: 101 },
      { senderId: 2, ts: 102 },
      { senderId: 2, ts: 103 },
      { senderId: 1, ts: 104 },
      { senderId: 3, ts: 105 },
      { senderId: 2, ts: 106 },
      { senderId: 5, ts: 107 },
      { senderId: 1, ts: 108 },
    ]
    const options = { lookAhead: 3, decaySeconds: 90 }

    assert.deepEqual(
      accumulateCoOccurrencePairBatches([messages.slice(0, 3), messages.slice(3, 5), messages.slice(5)], options),
      legacyAccumulateCoOccurrencePairs(messages, options)
    )
  })

  it('keeps large streamed aggregation identical to the in-memory algorithm', () => {
    const senderPattern = [1, 1, 2, 3, 2, 4, 5]
    const messages = Array.from({ length: 100_005 }, (_, index) => ({
      senderId: senderPattern[index % senderPattern.length],
      ts: 1_700_000_000 + index,
    }))

    assert.deepEqual(
      accumulateCoOccurrencePairBatches(
        [messages.slice(0, 20_000), messages.slice(20_000, 60_000), messages.slice(60_000)],
        { lookAhead: 3, decaySeconds: 120 }
      ),
      accumulateCoOccurrencePairs(messages, { lookAhead: 3, decaySeconds: 120 })
    )
  })

  it('keeps cluster graph message totals and member rankings after batched reads', () => {
    const database = createMentionDatabase()

    try {
      const result = getClusterGraph(database)

      assert.equal(result.stats.totalMessages, 6)
      assert.equal(result.stats.totalMembers, 3)
      assert.equal(result.stats.involvedMembers, 2)
      assert.ok(result.links.length > 0)
    } finally {
      database.close()
    }
  })

  it('returns only the two member rankings and total mention count', () => {
    const database = createMentionDatabase()

    try {
      assert.deepEqual(getMentionAnalysis(database), {
        topMentioners: [
          { memberId: 1, platformId: 'u1', name: 'Alice', count: 4, percentage: 66.67 },
          { memberId: 2, platformId: 'u2', name: 'Bob', count: 2, percentage: 33.33 },
        ],
        topMentioned: [
          { memberId: 2, platformId: 'u2', name: 'Bob', count: 3, percentage: 50 },
          { memberId: 1, platformId: 'u1', name: 'Alice', count: 2, percentage: 33.33 },
          { memberId: 3, platformId: 'u3', name: 'Carol', count: 1, percentage: 16.67 },
        ],
        totalMentions: 6,
      })
    } finally {
      database.close()
    }
  })
})
