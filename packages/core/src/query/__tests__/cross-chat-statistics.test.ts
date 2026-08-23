import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { MessageType } from '@openchatlab/shared-types'
import type { DatabaseAdapter, PreparedStatement, RunResult } from '../../interfaces'
import { getCrossChatSessionActivityFacts } from '../cross-chat-statistics'

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

function createSession(): Adapter {
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
    INSERT INTO meta VALUES ('Test Group', 'wechat', 'group', 1700000000, 'owner');
    INSERT INTO member VALUES
      (1, 'owner', 'Me', NULL, '[]', NULL),
      (2, 'alice', 'Alice', 'Alice G', '[]', NULL),
      (3, 'bob', 'Bob', NULL, '[]', NULL),
      (4, 'system', 'System', NULL, '[]', NULL);
  `)
  return new Adapter(raw)
}

function localTs(year: number, month: number, day: number, hour = 12): number {
  return Math.floor(new Date(year, month - 1, day, hour).getTime() / 1000)
}

function addMessage(db: Adapter, id: number, senderId: number, ts: number, type: MessageType = MessageType.TEXT): void {
  db.raw
    .prepare('INSERT INTO message VALUES (?, ?, ?, ?, ?, ?, NULL)')
    .run(id, senderId, ts, type, `message-${id}`, `platform-${id}`)
}

test('returns bounded session and per-member activity without system messages', () => {
  const db = createSession()
  try {
    addMessage(db, 1, 1, localTs(2023, 12, 31))
    addMessage(db, 2, 1, localTs(2024, 1, 1, 8))
    addMessage(db, 3, 2, localTs(2024, 1, 1, 9), MessageType.IMAGE)
    addMessage(db, 4, 1, localTs(2024, 1, 2, 10))
    addMessage(db, 5, 3, localTs(2024, 1, 2, 11))
    addMessage(db, 6, 2, localTs(2024, 1, 2, 12), MessageType.SYSTEM)
    addMessage(db, 7, 4, localTs(2024, 1, 2, 13))
    addMessage(db, 8, 2, localTs(2024, 1, 3, 0))

    const facts = getCrossChatSessionActivityFacts(db, {
      startTs: localTs(2024, 1, 1, 0),
      endTs: localTs(2024, 1, 2, 23),
    })

    assert.deepEqual(
      {
        totalMessages: facts.totalMessages,
        activeDays: facts.activeDays,
        activeMembers: facts.activeMembers,
        firstMessageTs: facts.firstMessageTs,
        lastMessageTs: facts.lastMessageTs,
        dataEarliestMessageTs: facts.dataEarliestMessageTs,
        dataLatestMessageTs: facts.dataLatestMessageTs,
      },
      {
        totalMessages: 4,
        activeDays: 2,
        activeMembers: 3,
        firstMessageTs: localTs(2024, 1, 1, 8),
        lastMessageTs: localTs(2024, 1, 2, 11),
        dataEarliestMessageTs: localTs(2023, 12, 31),
        dataLatestMessageTs: localTs(2024, 1, 3, 0),
      }
    )
    assert.deepEqual(
      facts.members.map((member) => ({
        memberId: member.memberId,
        memberName: member.memberName,
        messageCount: member.messageCount,
        activeDays: member.activeDays,
      })),
      [
        { memberId: 1, memberName: 'Me', messageCount: 2, activeDays: 2 },
        { memberId: 2, memberName: 'Alice G', messageCount: 1, activeDays: 1 },
        { memberId: 3, memberName: 'Bob', messageCount: 1, activeDays: 1 },
      ]
    )
    assert.deepEqual(facts.activeDayKeys, ['2024-01-01', '2024-01-02'])
  } finally {
    db.close()
  }
})

test('returns zero range facts while preserving the imported data cutoff', () => {
  const db = createSession()
  try {
    addMessage(db, 1, 1, localTs(2024, 1, 1))

    const facts = getCrossChatSessionActivityFacts(db, {
      startTs: localTs(2025, 1, 1, 0),
      endTs: localTs(2025, 12, 31, 23),
    })

    assert.equal(facts.totalMessages, 0)
    assert.equal(facts.activeDays, 0)
    assert.equal(facts.activeMembers, 0)
    assert.equal(facts.firstMessageTs, null)
    assert.equal(facts.lastMessageTs, null)
    assert.deepEqual(facts.members, [])
    assert.deepEqual(facts.activeDayKeys, [])
    assert.equal(facts.dataLatestMessageTs, localTs(2024, 1, 1))
  } finally {
    db.close()
  }
})
