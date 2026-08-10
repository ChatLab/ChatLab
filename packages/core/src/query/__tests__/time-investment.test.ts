import assert from 'node:assert/strict'
import test from 'node:test'
import Database from 'better-sqlite3'
import { ChatType, MessageType, type AnnualSummaryRange } from '@openchatlab/shared-types'
import { SqliteTestAdapter } from './sqlite-test-adapter'
import {
  aggregateTimeInvestmentFacts,
  estimateTimeInvestmentIntervals,
  getTimeInvestmentSessionFacts,
  type TimeInvestmentMessagePoint,
  type TimeInvestmentSessionFacts,
} from '../time-investment'

const range: AnnualSummaryRange = {
  mode: 'year',
  year: 2026,
  startTs: localTs(2026, 1, 1),
  endTs: localTs(2026, 12, 31, 23, 59, 59),
}

test('estimates bounded investment intervals from owner message anchors', () => {
  const points: TimeInvestmentMessagePoint[] = [
    { ts: 1_000, senderId: 2 },
    { ts: 1_060, senderId: 1 },
    { ts: 1_240, senderId: 1 },
    { ts: 1_300, senderId: 2 },
    { ts: 1_600, senderId: 2 },
  ]

  assert.deepEqual(estimateTimeInvestmentIntervals(points, 1, { startTs: 0, endTs: 10_000 }), [
    { startTs: 1_000, endTs: 1_360 },
  ])
})

test('includes non-system media anchors and caps a busy reply tail at five minutes', () => {
  const points: TimeInvestmentMessagePoint[] = [
    { ts: 2_000, senderId: 1 },
    { ts: 2_060, senderId: 2 },
    { ts: 2_180, senderId: 2 },
    { ts: 2_300, senderId: 2 },
    { ts: 2_360, senderId: 2 },
  ]

  assert.deepEqual(estimateTimeInvestmentIntervals(points, 1, { startTs: 0, endTs: 10_000 }), [
    { startTs: 2_000, endTs: 2_300 },
  ])
})

test('merges overlaps globally and allocates overlapping investment across sessions', () => {
  const facts: TimeInvestmentSessionFacts[] = [
    analyzedFacts('a', ChatType.PRIVATE, [interval(100, 300)]),
    analyzedFacts('b', ChatType.GROUP, [interval(200, 400)]),
  ]

  const result = aggregateTimeInvestmentFacts(facts, {
    mode: 'year',
    year: 1970,
    startTs: 0,
    endTs: 86_399,
  })

  assert.equal(result.metrics.estimatedSeconds, 300)
  assert.equal(result.metrics.activeDayCount, 1)
  assert.equal(
    result.sessionRanking.reduce((sum, item) => sum + item.seconds, 0),
    300
  )
  assert.deepEqual(
    result.sessionRanking.map(({ sessionId, seconds }) => ({ sessionId, seconds })),
    [
      { sessionId: 'a', seconds: 150 },
      { sessionId: 'b', seconds: 150 },
    ]
  )
})

test('queries real chat data, excludes system messages, and reports missing owners', () => {
  const raw = createDb('owner')
  const insert = raw.prepare('INSERT INTO message (sender_id, ts, type, content) VALUES (?, ?, ?, ?)')
  insert.run(2, localTs(2026, 5, 1, 9, 59), MessageType.TEXT, 'trigger')
  insert.run(1, localTs(2026, 5, 1, 10, 0), MessageType.IMAGE, '[image]')
  insert.run(3, localTs(2026, 5, 1, 10, 1), MessageType.SYSTEM, 'system')
  insert.run(2, localTs(2026, 5, 1, 10, 2), MessageType.TEXT, 'reply')

  const facts = getTimeInvestmentSessionFacts(new SqliteTestAdapter(raw), 'session-a', range)
  assert.equal(facts.kind, 'analyzed')
  if (facts.kind !== 'analyzed') return
  assert.equal(facts.sessionName, 'Example')
  assert.deepEqual(facts.investmentIntervals, [
    { startTs: localTs(2026, 5, 1, 9, 59), endTs: localTs(2026, 5, 1, 10, 3) },
  ])

  raw.prepare('UPDATE meta SET owner_id = NULL').run()
  assert.equal(getTimeInvestmentSessionFacts(new SqliteTestAdapter(raw), 'session-a', range).kind, 'missing_owner')
})

function createDb(ownerId: string | null): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE meta (
      name TEXT,
      platform TEXT,
      type TEXT,
      imported_at INTEGER,
      owner_id TEXT
    );
    CREATE TABLE member (
      id INTEGER PRIMARY KEY,
      platform_id TEXT NOT NULL,
      account_name TEXT,
      group_nickname TEXT,
      aliases TEXT DEFAULT '[]',
      avatar TEXT
    );
    CREATE TABLE message (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER,
      ts INTEGER,
      type INTEGER,
      content TEXT
    );
  `)
  db.prepare('INSERT INTO meta (name, platform, type, imported_at, owner_id) VALUES (?, ?, ?, ?, ?)').run(
    'Example',
    'qq',
    ChatType.PRIVATE,
    0,
    ownerId
  )
  db.prepare('INSERT INTO member (id, platform_id, account_name) VALUES (1, ?, ?)').run('owner', 'Me')
  db.prepare('INSERT INTO member (id, platform_id, account_name) VALUES (2, ?, ?)').run('friend', 'Friend')
  db.prepare('INSERT INTO member (id, platform_id, account_name) VALUES (3, ?, ?)').run('system', '系统消息')
  return db
}

function analyzedFacts(
  sessionId: string,
  chatType: ChatType,
  investmentIntervals: Array<{ startTs: number; endTs: number }>
): TimeInvestmentSessionFacts {
  return {
    kind: 'analyzed',
    sessionId,
    sessionName: sessionId,
    platform: 'qq',
    chatType,
    availableDataYears: [1970],
    investmentIntervals,
  }
}

function interval(startTs: number, endTs: number) {
  return { startTs, endTs }
}

function localTs(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  return Math.floor(new Date(year, month - 1, day, hour, minute, second).getTime() / 1000)
}
