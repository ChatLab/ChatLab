/**
 * Tests for ranking analytics migrated from frontend pluginCompute:
 *   getDragonKingAnalysis, getDivingAnalysis, getCheckInAnalysis,
 *   getMemeBattleAnalysis, getNightOwlAnalysis, getRepeatAnalysis.
 *
 * Locks the ported algorithms against the previous behavior using a real
 * in-memory SQLite DB. TZ is pinned to UTC so strftime('localtime') and JS
 * Date hour/date math are deterministic across machines.
 *
 * Run: npx tsx --test packages/core/src/query/advanced/__tests__/ranking.test.ts
 */

process.env.TZ = 'UTC'

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {
  getDragonKingAnalysis,
  getDivingAnalysis,
  getCheckInAnalysis,
  getMemeBattleAnalysis,
  getNightOwlAnalysis,
  getRepeatAnalysis,
} from '../ranking'
import type { DatabaseAdapter, PreparedStatement, RunResult } from '../../../interfaces'

class Stmt implements PreparedStatement {
  readonly?: boolean
  constructor(private stmt: Database.Statement) {
    this.readonly = stmt.readonly
  }
  get(...p: unknown[]) {
    return this.stmt.get(...p) as Record<string, unknown> | undefined
  }
  all(...p: unknown[]) {
    return this.stmt.all(...p) as Record<string, unknown>[]
  }
  run(...p: unknown[]): RunResult {
    const r = this.stmt.run(...p)
    return { changes: r.changes, lastInsertRowid: r.lastInsertRowid }
  }
}

class Adapter implements DatabaseAdapter {
  constructor(private db: Database.Database) {}
  exec(sql: string) {
    this.db.exec(sql)
  }
  prepare(sql: string) {
    return new Stmt(this.db.prepare(sql))
  }
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)()
  }
  pragma(p: string) {
    return this.db.pragma(p)
  }
  close() {
    this.db.close()
  }
}

interface Member {
  id: number
  name: string
  system?: boolean
}
interface Msg {
  id: number
  senderId: number
  ts: number
  type?: number
  content?: string | null
}

function makeDb(members: Member[], messages: Msg[]): Adapter {
  const raw = new Database(':memory:')
  raw.exec(`
    CREATE TABLE member (id INTEGER PRIMARY KEY, platform_id TEXT, account_name TEXT, group_nickname TEXT, avatar TEXT);
    CREATE TABLE message (id INTEGER PRIMARY KEY, sender_id INTEGER, ts INTEGER, type INTEGER, content TEXT);
  `)
  const mIns = raw.prepare('INSERT INTO member (id, platform_id, account_name, group_nickname) VALUES (?, ?, ?, ?)')
  for (const m of members) {
    mIns.run(m.id, `u${m.id}`, m.system ? '系统消息' : m.name, null)
  }
  const ins = raw.prepare('INSERT INTO message (id, sender_id, ts, type, content) VALUES (?, ?, ?, ?, ?)')
  for (const msg of messages) {
    ins.run(msg.id, msg.senderId, msg.ts, msg.type ?? 0, msg.content ?? 'x')
  }
  return new Adapter(raw)
}

const DAY1 = 1704067200 // 2024-01-01 00:00:00 UTC
const DAY2 = DAY1 + 86400 // 2024-01-02
const DAY3 = DAY2 + 86400 // 2024-01-03

describe('ranking analytics (ported algorithms)', () => {
  it('getDragonKingAnalysis ranks daily top sender', () => {
    // A 两天都是发言最多 -> dragon_days=2；B 从未夺冠 -> 不进榜
    const db = makeDb(
      [
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
      ],
      [
        { id: 1, senderId: 1, ts: DAY1 + 10 },
        { id: 2, senderId: 1, ts: DAY1 + 20 },
        { id: 3, senderId: 1, ts: DAY1 + 30 },
        { id: 4, senderId: 2, ts: DAY1 + 40 },
        { id: 5, senderId: 1, ts: DAY2 + 10 },
        { id: 6, senderId: 1, ts: DAY2 + 20 },
        { id: 7, senderId: 2, ts: DAY2 + 30 },
      ]
    )
    const res = getDragonKingAnalysis(db)
    assert.equal(res.totalDays, 2)
    assert.equal(res.rank.length, 1)
    assert.equal(res.rank[0].memberId, 1)
    assert.equal(res.rank[0].count, 2)
    assert.equal(res.rank[0].percentage, 100)
  })

  it('getDivingAnalysis orders by last message ascending', () => {
    const db = makeDb(
      [
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
      ],
      [
        { id: 1, senderId: 1, ts: DAY3 + 5 },
        { id: 2, senderId: 2, ts: DAY1 + 5 },
      ]
    )
    const res = getDivingAnalysis(db)
    assert.equal(res.rank.length, 2)
    assert.equal(res.rank[0].memberId, 2) // B 最久没发言，排最前
    assert.equal(res.rank[0].lastMessageTs, DAY1 + 5)
    assert.equal(res.rank[1].memberId, 1)
  })

  it('getCheckInAnalysis computes max/current streak and loyalty', () => {
    // A: 01-01,02,03 连续 streak3；B: 01-01,03 有断层 streak1
    const db = makeDb(
      [
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
      ],
      [
        { id: 1, senderId: 1, ts: DAY1 + 5 },
        { id: 2, senderId: 1, ts: DAY2 + 5 },
        { id: 3, senderId: 1, ts: DAY3 + 5 },
        { id: 4, senderId: 2, ts: DAY1 + 6 },
        { id: 5, senderId: 2, ts: DAY3 + 6 },
      ]
    )
    const res = getCheckInAnalysis(db)
    assert.equal(res.totalDays, 3)
    const a = res.streakRank.find((r) => r.memberId === 1)!
    const b = res.streakRank.find((r) => r.memberId === 2)!
    assert.equal(a.maxStreak, 3)
    assert.equal(a.currentStreak, 3)
    assert.equal(b.maxStreak, 1)
    assert.equal(b.currentStreak, 1)
    const la = res.loyaltyRank.find((r) => r.memberId === 1)!
    const lb = res.loyaltyRank.find((r) => r.memberId === 2)!
    assert.equal(la.totalDays, 3)
    assert.equal(la.percentage, 100)
    assert.equal(lb.totalDays, 2)
    assert.equal(lb.percentage, 67)
  })

  it('getMemeBattleAnalysis detects image chains with >=3 msgs and >=2 senders', () => {
    // A,B,A 连续图片 (type 1) -> 一场斗图；C 文字打断
    const db = makeDb(
      [
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
        { id: 3, name: 'C' },
      ],
      [
        { id: 1, senderId: 1, ts: DAY1 + 1, type: 1 },
        { id: 2, senderId: 2, ts: DAY1 + 2, type: 1 },
        { id: 3, senderId: 1, ts: DAY1 + 3, type: 5 },
        { id: 4, senderId: 3, ts: DAY1 + 4, type: 0 },
      ]
    )
    const res = getMemeBattleAnalysis(db)
    assert.equal(res.totalBattles, 1)
    assert.equal(res.topBattles[0].totalImages, 3)
    assert.equal(res.topBattles[0].participantCount, 2)
    // A 发 2 张图，B 发 1 张
    assert.equal(res.rankByImageCount[0].memberId, 1)
    assert.equal(res.rankByImageCount[0].count, 2)
    const aCount = res.rankByCount.find((r) => r.memberId === 1)!
    assert.equal(aCount.count, 1) // 参与 1 场
  })

  it('getNightOwlAnalysis counts late-night messages per member', () => {
    // 同一成员 23 点 / 次日 0 点 / 次日 1 点 各一条，调整后同属一天
    const db = makeDb(
      [{ id: 1, name: 'A' }],
      [
        { id: 1, senderId: 1, ts: DAY1 + 23 * 3600 }, // 23:00
        { id: 2, senderId: 1, ts: DAY2 + 0 * 3600 + 60 }, // 次日 00:01
        { id: 3, senderId: 1, ts: DAY2 + 1 * 3600 }, // 次日 01:00
      ]
    )
    const res = getNightOwlAnalysis(db)
    assert.equal(res.totalDays, 1)
    assert.equal(res.nightOwlRank.length, 1)
    const owl = res.nightOwlRank[0]
    assert.equal(owl.totalNightMessages, 3)
    assert.equal(owl.title, '偶尔失眠')
    assert.deepEqual(owl.hourlyBreakdown, { h23: 1, h0: 1, h1: 1, h2: 0, h3to4: 0 })
  })

  it('getRepeatAnalysis detects repeat chains with originator/initiator/breaker', () => {
    // A,B,C 复读 "haha" 形成长度 3 的链，D 用 "bye" 打断
    const db = makeDb(
      [
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
        { id: 3, name: 'C' },
        { id: 4, name: 'D' },
      ],
      [
        { id: 1, senderId: 1, ts: DAY1 + 1, content: 'haha' },
        { id: 2, senderId: 2, ts: DAY1 + 2, content: 'haha' },
        { id: 3, senderId: 3, ts: DAY1 + 3, content: 'haha' },
        { id: 4, senderId: 4, ts: DAY1 + 4, content: 'bye' },
      ]
    )
    const res = getRepeatAnalysis(db)
    assert.equal(res.totalRepeatChains, 1)
    assert.equal(res.avgChainLength, 3)
    assert.deepEqual(res.chainLengthDistribution, [{ length: 3, count: 1 }])
    assert.equal(res.originators[0].memberId, 1)
    assert.equal(res.initiators[0].memberId, 2)
    assert.equal(res.breakers[0].memberId, 4)
    assert.equal(res.hotContents[0].content, 'haha')
    assert.equal(res.hotContents[0].maxChainLength, 3)
  })

  it('excludes system messages for system-filtered analyses', () => {
    // 系统消息成员不应进入龙王榜
    const db = makeDb(
      [
        { id: 1, name: 'A' },
        { id: 99, name: 'sys', system: true },
      ],
      [
        { id: 1, senderId: 1, ts: DAY1 + 1 },
        { id: 2, senderId: 99, ts: DAY1 + 2 },
        { id: 3, senderId: 99, ts: DAY1 + 3 },
      ]
    )
    const res = getDragonKingAnalysis(db)
    assert.equal(res.rank.length, 1)
    assert.equal(res.rank[0].memberId, 1)
  })
})
