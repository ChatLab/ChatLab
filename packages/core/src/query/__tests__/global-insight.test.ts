import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { ChatType, MessageType } from '@openchatlab/shared-types'
import type { DatabaseAdapter, PreparedStatement, RunResult } from '../../interfaces'
import type { AnnualSummarySessionFacts } from '../global-insight'
import { aggregateAnnualSummaryFacts, getAnnualSummarySessionFacts } from '../global-insight'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

class StatementAdapter implements PreparedStatement {
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
  constructor(readonly raw: Database.Database) {}
  exec(sql: string) {
    this.raw.exec(sql)
  }
  prepare(sql: string) {
    return new StatementAdapter(this.raw.prepare(sql))
  }
  transaction<T>(fn: () => T): T {
    return this.raw.transaction(fn)()
  }
  pragma(query: string) {
    return this.raw.pragma(query)
  }
  close() {
    this.raw.close()
  }
}

interface SessionInput {
  id: string
  platform?: string
  type: ChatType
  ownerId?: string | null
  contactPlatformId?: string
}

function createSession(input: SessionInput): Adapter {
  const raw = new Database(':memory:', { nativeBinding })
  raw.exec(`
    CREATE TABLE meta (name TEXT, platform TEXT, type TEXT, imported_at INTEGER, owner_id TEXT);
    CREATE TABLE member (
      id INTEGER PRIMARY KEY,
      platform_id TEXT,
      account_name TEXT,
      group_nickname TEXT,
      aliases TEXT DEFAULT '[]',
      avatar TEXT
    );
    CREATE TABLE message (
      id INTEGER PRIMARY KEY,
      sender_id INTEGER,
      ts INTEGER,
      type INTEGER,
      content TEXT,
      platform_message_id TEXT,
      reply_to_message_id TEXT
    );
  `)
  raw
    .prepare('INSERT INTO meta VALUES (?, ?, ?, ?, ?)')
    .run(
      input.id,
      input.platform ?? 'weixin',
      input.type,
      1700000000,
      input.ownerId === undefined ? 'owner' : input.ownerId
    )
  raw.prepare('INSERT INTO member VALUES (?, ?, ?, ?, ?, ?)').run(1, 'owner', 'Me', null, '[]', null)
  raw
    .prepare('INSERT INTO member VALUES (?, ?, ?, ?, ?, ?)')
    .run(2, input.contactPlatformId ?? 'alice', 'Alice', null, '[]', null)
  return new Adapter(raw)
}

function localTs(year: number, month: number, day: number, hour = 12): number {
  return Math.floor(new Date(year, month - 1, day, hour).getTime() / 1000)
}

function addMessage(
  db: Adapter,
  input: {
    id: number
    senderId: number
    ts: number
    type?: MessageType
    content?: string | null
    platformMessageId: string
    replyToMessageId?: string | null
  }
): void {
  db.raw
    .prepare('INSERT INTO message VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(
      input.id,
      input.senderId,
      input.ts,
      input.type ?? MessageType.TEXT,
      input.content ?? 'x',
      input.platformMessageId,
      input.replyToMessageId ?? null
    )
}

const range2024 = {
  mode: 'year' as const,
  year: 2024,
  startTs: localTs(2024, 1, 1, 0),
  endTs: localTs(2024, 12, 31, 23),
}

test('collects owner facts and explicit group reply contacts', () => {
  const db = createSession({ id: 'group-1', type: ChatType.GROUP })
  addMessage(db, {
    id: 1,
    senderId: 1,
    ts: localTs(2024, 1, 1),
    content: 'hi',
    platformMessageId: 'owner-1',
  })
  addMessage(db, {
    id: 2,
    senderId: 1,
    ts: localTs(2024, 1, 2),
    type: MessageType.IMAGE,
    content: null,
    platformMessageId: 'owner-2',
  })
  addMessage(db, {
    id: 3,
    senderId: 2,
    ts: localTs(2024, 1, 2, 13),
    content: 'reply',
    platformMessageId: 'alice-1',
    replyToMessageId: 'owner-1',
  })
  addMessage(db, {
    id: 4,
    senderId: 2,
    ts: localTs(2023, 12, 31),
    content: 'old',
    platformMessageId: 'alice-old',
  })

  const facts = getAnnualSummarySessionFacts(db, 'group-1', range2024)

  assert.equal(facts.kind, 'analyzed')
  if (facts.kind !== 'analyzed') return
  assert.deepEqual(facts.availableDataYears, [2024])
  assert.deepEqual(facts.ownerMessagesByDay, { '2024-01-01': 1, '2024-01-02': 1 })
  assert.deepEqual(facts.messageTypeCounts, { '0': 1, '1': 1 })
  assert.deepEqual(facts.textLengthCounts, { '2': 1 })
  assert.deepEqual(facts.directContactKeysByDay, { '2024-01-02': ['weixin:alice'] })
  db.close()
})

test('counts an active private counterpart on each day and scopes name-match identities', () => {
  const db = createSession({ id: 'private-1', platform: 'whatsapp', type: ChatType.PRIVATE })
  addMessage(db, {
    id: 1,
    senderId: 2,
    ts: localTs(2024, 2, 1),
    content: 'hello',
    platformMessageId: 'alice-1',
  })
  addMessage(db, {
    id: 2,
    senderId: 1,
    ts: localTs(2024, 2, 2),
    content: 'world',
    platformMessageId: 'owner-1',
  })

  const facts = getAnnualSummarySessionFacts(db, 'private-1', range2024)

  assert.equal(facts.kind, 'analyzed')
  if (facts.kind !== 'analyzed') return
  assert.deepEqual(facts.directContactKeysByDay, {
    '2024-02-01': ['whatsapp:private-1:alice'],
    '2024-02-02': ['whatsapp:private-1:alice'],
  })
  db.close()
})

test('ignores legacy system messages when counting private direct-contact days', () => {
  const db = createSession({ id: 'private-system', type: ChatType.PRIVATE })
  db.raw.prepare('INSERT INTO member VALUES (?, ?, ?, ?, ?, ?)').run(3, 'system', '系统消息', null, '[]', null)
  addMessage(db, {
    id: 1,
    senderId: 3,
    ts: localTs(2024, 2, 1),
    content: 'notification',
    platformMessageId: 'system-1',
  })

  const facts = getAnnualSummarySessionFacts(db, 'private-system', range2024)

  assert.equal(facts.kind, 'analyzed')
  if (facts.kind !== 'analyzed') return
  assert.deepEqual(facts.directContactKeysByDay, {})
  db.close()
})

test('reports missing and unresolved owners instead of guessing', () => {
  const missing = createSession({ id: 'missing', type: ChatType.PRIVATE, ownerId: null })
  const unresolved = createSession({ id: 'unresolved', type: ChatType.GROUP, ownerId: 'unknown' })

  assert.equal(getAnnualSummarySessionFacts(missing, 'missing', range2024).kind, 'missing_owner')
  assert.equal(getAnnualSummarySessionFacts(unresolved, 'unresolved', range2024).kind, 'unresolved_owner')
  missing.close()
  unresolved.close()
})

test('aggregates sessions, de-duplicates contacts, fills months, and computes exact text percentiles', () => {
  const facts: AnnualSummarySessionFacts[] = [
    {
      kind: 'analyzed' as const,
      availableDataYears: [2024, 2023],
      ownerMessagesByDay: { '2024-01-01': 2, '2024-01-03': 1 },
      directContactKeysByDay: {
        '2024-01-01': ['weixin:alice'],
        '2024-01-03': ['weixin:alice', 'weixin:bob'],
      },
      messageTypeCounts: { '0': 2, '1': 1 },
      textLengthCounts: { '2': 1, '10': 1 },
    },
    {
      kind: 'analyzed' as const,
      availableDataYears: [2024],
      ownerMessagesByDay: { '2024-01-01': 1, '2024-02-01': 1 },
      directContactKeysByDay: {
        '2024-01-01': ['weixin:alice'],
        '2024-02-01': ['weixin:alice', 'weixin:carol'],
      },
      messageTypeCounts: { '0': 2 },
      textLengthCounts: { '50': 1, '400': 1 },
    },
    { kind: 'missing_owner' as const, availableDataYears: [] },
  ]

  const result = aggregateAnnualSummaryFacts(facts, range2024, 366)

  assert.deepEqual(result.availableDataYears, [2024, 2023])
  assert.deepEqual(result.metrics, {
    sentMessageCount: 5,
    activeDayCount: 3,
    directContactCount: 3,
    averageMessagesPerDay: 0.01,
    averageDirectContactsPerDay: 0.01,
  })
  assert.deepEqual(result.monthlyActivity.slice(0, 3), [
    { month: '2024-01', messageCount: 4 },
    { month: '2024-02', messageCount: 1 },
    { month: '2024-03', messageCount: 0 },
  ])
  assert.equal(result.monthlyActivity.length, 12)
  assert.deepEqual(result.monthlyDirectContacts.slice(0, 3), [
    { month: '2024-01', contactCount: 2 },
    { month: '2024-02', contactCount: 2 },
    { month: '2024-03', contactCount: 0 },
  ])
  assert.equal(result.monthlyDirectContacts.length, 12)
  assert.deepEqual(result.dailyActivity, [
    { date: '2024-01-01', messageCount: 3 },
    { date: '2024-01-03', messageCount: 1 },
    { date: '2024-02-01', messageCount: 1 },
  ])
  assert.deepEqual(result.messageTypes, [
    { type: 0, count: 4 },
    { type: 1, count: 1 },
  ])
  assert.deepEqual(result.textLength, {
    textMessageCount: 4,
    median: 10,
    p90: 50,
    buckets: [
      { key: '1-10', count: 2 },
      { key: '11-30', count: 0 },
      { key: '31-100', count: 1 },
      { key: '101-300', count: 0 },
      { key: '300+', count: 1 },
    ],
  })
  assert.deepEqual(result.coverage, {
    totalSessions: 3,
    analyzedSessions: 2,
    missingOwnerSessions: 1,
    unresolvedOwnerSessions: 0,
    failedSessions: 0,
  })
})

test('fills every calendar month in a recent-range contact trend', () => {
  const range = {
    mode: 'recent' as const,
    days: 365 as const,
    startTs: localTs(2025, 12, 15, 0),
    endTs: localTs(2026, 2, 10, 23),
  }
  const facts: AnnualSummarySessionFacts[] = [
    {
      kind: 'analyzed',
      availableDataYears: [2026],
      ownerMessagesByDay: {},
      directContactKeysByDay: { '2026-01-02': ['weixin:alice'] },
      messageTypeCounts: {},
      textLengthCounts: {},
    },
  ]

  const result = aggregateAnnualSummaryFacts(facts, range, 58)

  assert.deepEqual(result.monthlyDirectContacts, [
    { month: '2025-12', contactCount: 0 },
    { month: '2026-01', contactCount: 1 },
    { month: '2026-02', contactCount: 0 },
  ])
})
