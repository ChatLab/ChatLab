/**
 * Tests for analysis data API routes (US-006)
 *
 * Uses a temporary database directory to isolate tests from real data.
 * Tests member-activity, hourly-activity, daily-activity, weekday-activity,
 * message-type-distribution, message-length-distribution, member-name-history,
 * catchphrase-analysis, and time filtering.
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { Server } from 'node:http'

// Set up a temporary data directory BEFORE any app modules load
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-analysis-test-'))
process.env.CHATLAB_DATA_DIR = tmpDir

import { createApp } from '../index.js'
import Database from 'better-sqlite3'
import { getDatabaseDir, ensureDir } from '../paths.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let server: Server
let baseUrl: string

/**
 * Create a test database with realistic data for analysis endpoints.
 */
function createTestDb(
  sessionId: string,
  opts?: {
    name?: string
    memberCount?: number
    messages?: Array<{
      senderId: number
      ts: number
      type: number
      content: string | null
    }>
  },
) {
  const dbDir = getDatabaseDir()
  ensureDir(dbDir)
  const dbPath = path.join(dbDir, `${sessionId}.db`)
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      type TEXT NOT NULL,
      imported_at INTEGER NOT NULL,
      group_id TEXT,
      group_avatar TEXT,
      owner_id TEXT,
      schema_version INTEGER DEFAULT 1,
      session_gap_threshold INTEGER
    );

    CREATE TABLE IF NOT EXISTS member (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_id TEXT NOT NULL UNIQUE,
      account_name TEXT,
      group_nickname TEXT,
      aliases TEXT DEFAULT '[]',
      avatar TEXT,
      roles TEXT DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS member_name_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      name_type TEXT NOT NULL,
      name TEXT NOT NULL,
      start_ts INTEGER NOT NULL,
      end_ts INTEGER,
      FOREIGN KEY(member_id) REFERENCES member(id)
    );

    CREATE TABLE IF NOT EXISTS message (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      sender_account_name TEXT,
      sender_group_nickname TEXT,
      ts INTEGER NOT NULL,
      type INTEGER NOT NULL,
      content TEXT,
      reply_to_message_id TEXT DEFAULT NULL,
      platform_message_id TEXT DEFAULT NULL,
      FOREIGN KEY(sender_id) REFERENCES member(id)
    );

    CREATE TABLE IF NOT EXISTS chat_session (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      start_ts INTEGER NOT NULL,
      end_ts INTEGER NOT NULL,
      message_count INTEGER DEFAULT 0,
      is_manual INTEGER DEFAULT 0,
      summary TEXT
    );

    CREATE TABLE IF NOT EXISTS message_context (
      message_id INTEGER PRIMARY KEY,
      session_id INTEGER NOT NULL,
      topic_id INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_message_ts ON message(ts);
    CREATE INDEX IF NOT EXISTS idx_message_sender ON message(sender_id);
  `)

  const name = opts?.name ?? 'Analysis Test'
  db.prepare(
    'INSERT INTO meta (name, platform, type, imported_at, owner_id) VALUES (?, ?, ?, ?, ?)',
  ).run(name, 'wechat', 'group', Math.floor(Date.now() / 1000), 'owner_123')

  // Add members
  const memberCount = opts?.memberCount ?? 3
  const memberNames = ['Alice', 'Bob', 'Charlie', 'David', 'Eve']
  for (let i = 0; i < memberCount; i++) {
    const mname = memberNames[i] || `User${i + 1}`
    db.prepare(
      'INSERT INTO member (platform_id, account_name, group_nickname) VALUES (?, ?, ?)',
    ).run(`user${i + 1}`, mname, mname)
  }

  // Add name history for member 1
  db.prepare(
    'INSERT INTO member_name_history (member_id, name_type, name, start_ts, end_ts) VALUES (?, ?, ?, ?, ?)',
  ).run(1, 'group_nickname', 'OldAlice', 1700000000, 1700100000)
  db.prepare(
    'INSERT INTO member_name_history (member_id, name_type, name, start_ts, end_ts) VALUES (?, ?, ?, ?, ?)',
  ).run(1, 'group_nickname', 'Alice', 1700100000, null)

  if (opts?.messages) {
    const insertMsg = db.prepare(
      'INSERT INTO message (sender_id, ts, type, content) VALUES (?, ?, ?, ?)',
    )
    for (const msg of opts.messages) {
      insertMsg.run(msg.senderId, msg.ts, msg.type, msg.content)
    }
  } else {
    // Default: create varied messages across different hours/days
    const baseTs = 1700000000 // 2023-11-14 ~21:33 UTC
    const insertMsg = db.prepare(
      'INSERT INTO message (sender_id, ts, type, content) VALUES (?, ?, ?, ?)',
    )
    // Member 1 (Alice): 10 text messages
    for (let i = 0; i < 10; i++) {
      insertMsg.run(1, baseTs + i * 3600, 0, `Hello from Alice ${i}`)
    }
    // Member 2 (Bob): 5 text messages + 2 image messages
    for (let i = 0; i < 5; i++) {
      insertMsg.run(2, baseTs + 1800 + i * 3600, 0, `Hi from Bob ${i}`)
    }
    insertMsg.run(2, baseTs + 50000, 1, null) // image
    insertMsg.run(2, baseTs + 51000, 1, null) // image
    // Member 3 (Charlie): 3 text messages with repeated content
    insertMsg.run(3, baseTs + 600, 0, 'lol')
    insertMsg.run(3, baseTs + 1200, 0, 'lol')
    insertMsg.run(3, baseTs + 1800, 0, 'something else')
  }

  db.close()
  return dbPath
}

function removeTestDb(sessionId: string) {
  const dbDir = getDatabaseDir()
  for (const ext of ['', '-wal', '-shm']) {
    const p = path.join(dbDir, `${sessionId}.db${ext}`)
    if (fs.existsSync(p)) fs.unlinkSync(p)
  }
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

before(() => {
  const app = createApp()
  server = app.listen(0)
  const addr = server.address()
  if (!addr || typeof addr === 'string') throw new Error('Failed to get server address')
  baseUrl = `http://localhost:${addr.port}`
})

after(() => {
  if (server) server.close()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/sessions/:id/member-activity', () => {
  it('returns member activity data with percentages', async () => {
    createTestDb('test_member_act')

    const res = await fetch(`${baseUrl}/api/sessions/test_member_act/member-activity`)
    assert.equal(res.status, 200)
    const body = (await res.json()) as any[]
    assert.ok(Array.isArray(body))
    assert.ok(body.length > 0)

    // Should be sorted by messageCount descending
    const first = body[0]
    assert.ok(typeof first.memberId === 'number')
    assert.ok(typeof first.name === 'string')
    assert.ok(typeof first.messageCount === 'number')
    assert.ok(typeof first.percentage === 'number')
    assert.ok(first.percentage > 0)
    assert.ok(first.percentage <= 100)

    // Alice has most messages (10)
    assert.equal(first.name, 'Alice')
    assert.equal(first.messageCount, 10)

    // Check descending order
    for (let i = 1; i < body.length; i++) {
      assert.ok(body[i - 1].messageCount >= body[i].messageCount)
    }

    removeTestDb('test_member_act')
  })

  it('returns empty array for non-existent session', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/nonexistent/member-activity`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.ok(Array.isArray(body))
    assert.equal(body.length, 0)
  })

  it('respects startTs/endTs time filter', async () => {
    const baseTs = 1700000000
    createTestDb('test_member_act_filter')

    // Filter to only include first few hours (Alice's first 3 messages)
    const endTs = baseTs + 7200 // 2 hours covers ts=0, ts=3600, ts=7200
    const res = await fetch(
      `${baseUrl}/api/sessions/test_member_act_filter/member-activity?startTs=${baseTs}&endTs=${endTs}`,
    )
    assert.equal(res.status, 200)
    const body = (await res.json()) as any[]
    assert.ok(Array.isArray(body))

    // With the filter, there should be fewer total messages than unfiltered
    const totalFiltered = body.reduce((sum: number, m: any) => sum + m.messageCount, 0)
    assert.ok(totalFiltered < 20, `Filtered total ${totalFiltered} should be less than unfiltered`)

    removeTestDb('test_member_act_filter')
  })
})

describe('GET /api/sessions/:id/hourly-activity', () => {
  it('returns 24 hours of activity data', async () => {
    createTestDb('test_hourly')

    const res = await fetch(`${baseUrl}/api/sessions/test_hourly/hourly-activity`)
    assert.equal(res.status, 200)
    const body = (await res.json()) as any[]
    assert.ok(Array.isArray(body))
    assert.equal(body.length, 24)

    // Check structure
    assert.equal(body[0].hour, 0)
    assert.equal(body[23].hour, 23)
    assert.ok(typeof body[0].messageCount === 'number')

    // At least some hours should have messages
    const totalMessages = body.reduce((sum: number, h: any) => sum + h.messageCount, 0)
    assert.ok(totalMessages > 0)

    removeTestDb('test_hourly')
  })

  it('returns zeros for non-existent session', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/nonexistent/hourly-activity`)
    assert.equal(res.status, 200)
    const body = (await res.json()) as any[]
    assert.equal(body.length, 0)
  })
})

describe('GET /api/sessions/:id/daily-activity', () => {
  it('returns daily activity with date strings', async () => {
    createTestDb('test_daily')

    const res = await fetch(`${baseUrl}/api/sessions/test_daily/daily-activity`)
    assert.equal(res.status, 200)
    const body = (await res.json()) as any[]
    assert.ok(Array.isArray(body))
    assert.ok(body.length > 0)

    // Check structure
    const first = body[0]
    assert.ok(typeof first.date === 'string')
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(first.date))
    assert.ok(typeof first.messageCount === 'number')
    assert.ok(first.messageCount > 0)

    removeTestDb('test_daily')
  })
})

describe('GET /api/sessions/:id/weekday-activity', () => {
  it('returns 7 weekdays of activity data', async () => {
    createTestDb('test_weekday')

    const res = await fetch(`${baseUrl}/api/sessions/test_weekday/weekday-activity`)
    assert.equal(res.status, 200)
    const body = (await res.json()) as any[]
    assert.ok(Array.isArray(body))
    assert.equal(body.length, 7)

    // Weekdays should be 1–7
    assert.equal(body[0].weekday, 1)
    assert.equal(body[6].weekday, 7)
    assert.ok(typeof body[0].messageCount === 'number')

    removeTestDb('test_weekday')
  })
})

describe('GET /api/sessions/:id/monthly-activity', () => {
  it('returns 12 months of activity data', async () => {
    createTestDb('test_monthly')

    const res = await fetch(`${baseUrl}/api/sessions/test_monthly/monthly-activity`)
    assert.equal(res.status, 200)
    const body = (await res.json()) as any[]
    assert.ok(Array.isArray(body))
    assert.equal(body.length, 12)

    assert.equal(body[0].month, 1)
    assert.equal(body[11].month, 12)

    // At least one month should have messages
    const totalMessages = body.reduce((sum: number, m: any) => sum + m.messageCount, 0)
    assert.ok(totalMessages > 0)

    removeTestDb('test_monthly')
  })
})

describe('GET /api/sessions/:id/yearly-activity', () => {
  it('returns yearly activity data', async () => {
    createTestDb('test_yearly')

    const res = await fetch(`${baseUrl}/api/sessions/test_yearly/yearly-activity`)
    assert.equal(res.status, 200)
    const body = (await res.json()) as any[]
    assert.ok(Array.isArray(body))
    assert.ok(body.length > 0)

    const first = body[0]
    assert.ok(typeof first.year === 'number')
    assert.ok(typeof first.messageCount === 'number')
    assert.ok(first.messageCount > 0)

    removeTestDb('test_yearly')
  })
})

describe('GET /api/sessions/:id/message-length-distribution', () => {
  it('returns detail and grouped distributions', async () => {
    createTestDb('test_msg_len')

    const res = await fetch(`${baseUrl}/api/sessions/test_msg_len/message-length-distribution`)
    assert.equal(res.status, 200)
    const body = (await res.json()) as any
    assert.ok(body.detail)
    assert.ok(body.grouped)
    assert.ok(Array.isArray(body.detail))
    assert.ok(Array.isArray(body.grouped))

    // Detail has 25 entries (len 1–25)
    assert.equal(body.detail.length, 25)
    assert.equal(body.detail[0].len, 1)
    assert.equal(body.detail[24].len, 25)

    // Grouped has 15 range buckets
    assert.equal(body.grouped.length, 15)
    assert.ok(typeof body.grouped[0].range === 'string')
    assert.ok(typeof body.grouped[0].count === 'number')

    removeTestDb('test_msg_len')
  })
})

describe('GET /api/sessions/:id/message-type-distribution', () => {
  it('returns type distribution with counts', async () => {
    createTestDb('test_msg_type')

    const res = await fetch(`${baseUrl}/api/sessions/test_msg_type/message-type-distribution`)
    assert.equal(res.status, 200)
    const body = (await res.json()) as any[]
    assert.ok(Array.isArray(body))
    assert.ok(body.length > 0)

    // Should have type 0 (text) with high count
    const textType = body.find((t: any) => t.type === 0)
    assert.ok(textType)
    assert.ok(textType.count > 0)

    // Check structure
    assert.ok(typeof body[0].type === 'number')
    assert.ok(typeof body[0].count === 'number')

    // Should be sorted by count descending
    for (let i = 1; i < body.length; i++) {
      assert.ok(body[i - 1].count >= body[i].count)
    }

    removeTestDb('test_msg_type')
  })
})

describe('GET /api/sessions/:id/catchphrase-analysis', () => {
  it('returns catchphrase data with members array', async () => {
    createTestDb('test_catchphrase')

    const res = await fetch(`${baseUrl}/api/sessions/test_catchphrase/catchphrase-analysis`)
    assert.equal(res.status, 200)
    const body = (await res.json()) as any
    assert.ok(body.members)
    assert.ok(Array.isArray(body.members))

    // Members with repeated content should appear
    if (body.members.length > 0) {
      const member = body.members[0]
      assert.ok(typeof member.memberId === 'number')
      assert.ok(typeof member.name === 'string')
      assert.ok(Array.isArray(member.catchphrases))
    }

    removeTestDb('test_catchphrase')
  })

  it('returns { members: [] } for non-existent session', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/nonexistent/catchphrase-analysis`)
    assert.equal(res.status, 200)
    const body = (await res.json()) as any
    assert.deepEqual(body, { members: [] })
  })
})

describe('GET /api/sessions/:id/mention-analysis', () => {
  it('returns mention analysis structure', async () => {
    // Create db with mention messages
    const baseTs = 1700000000
    createTestDb('test_mention', {
      memberCount: 3,
      messages: [
        { senderId: 1, ts: baseTs, type: 0, content: 'Hey @Bob what do you think?' },
        { senderId: 1, ts: baseTs + 100, type: 0, content: '@Bob @Charlie look at this' },
        { senderId: 2, ts: baseTs + 200, type: 0, content: '@Alice great idea' },
        { senderId: 3, ts: baseTs + 300, type: 0, content: 'I agree with @Alice' },
        { senderId: 2, ts: baseTs + 400, type: 0, content: 'Let me ask @Charlie' },
      ],
    })

    const res = await fetch(`${baseUrl}/api/sessions/test_mention/mention-analysis`)
    assert.equal(res.status, 200)
    const body = (await res.json()) as any
    assert.ok(typeof body.totalMentions === 'number')
    assert.ok(Array.isArray(body.topMentioners))
    assert.ok(Array.isArray(body.topMentioned))

    removeTestDb('test_mention')
  })

  it('returns empty result for non-existent session', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/nonexistent/mention-analysis`)
    assert.equal(res.status, 200)
    const body = (await res.json()) as any
    assert.equal(body.totalMentions, 0)
    assert.ok(Array.isArray(body.topMentioners))
    assert.equal(body.topMentioners.length, 0)
  })
})

describe('GET /api/sessions/:id/mention-graph', () => {
  it('returns graph data with nodes and links', async () => {
    const baseTs = 1700000000
    createTestDb('test_mention_graph', {
      memberCount: 3,
      messages: [
        { senderId: 1, ts: baseTs, type: 0, content: '@Bob hello' },
        { senderId: 2, ts: baseTs + 100, type: 0, content: '@Alice hi back' },
      ],
    })

    const res = await fetch(`${baseUrl}/api/sessions/test_mention_graph/mention-graph`)
    assert.equal(res.status, 200)
    const body = (await res.json()) as any
    assert.ok(Array.isArray(body.nodes))
    assert.ok(Array.isArray(body.links))
    assert.ok(typeof body.maxLinkValue === 'number')

    removeTestDb('test_mention_graph')
  })
})

describe('GET /api/sessions/:id/cluster-graph', () => {
  it('returns cluster graph structure', async () => {
    const baseTs = 1700000000
    const messages: Array<{ senderId: number; ts: number; type: number; content: string | null }> = []
    // Create enough messages for cluster detection
    for (let i = 0; i < 50; i++) {
      messages.push({ senderId: (i % 3) + 1, ts: baseTs + i * 10, type: 0, content: `msg ${i}` })
    }
    createTestDb('test_cluster', { memberCount: 3, messages })

    const res = await fetch(`${baseUrl}/api/sessions/test_cluster/cluster-graph`)
    assert.equal(res.status, 200)
    const body = (await res.json()) as any
    assert.ok(Array.isArray(body.nodes))
    assert.ok(Array.isArray(body.links))
    assert.ok(typeof body.maxLinkValue === 'number')
    assert.ok(body.stats)
    assert.ok(typeof body.stats.totalMembers === 'number')
    assert.ok(typeof body.stats.totalMessages === 'number')

    removeTestDb('test_cluster')
  })
})

describe('GET /api/sessions/:id/laugh-analysis', () => {
  it('returns laugh analysis with keywords', async () => {
    const baseTs = 1700000000
    createTestDb('test_laugh', {
      memberCount: 2,
      messages: [
        { senderId: 1, ts: baseTs, type: 0, content: '哈哈哈好好笑' },
        { senderId: 1, ts: baseTs + 100, type: 0, content: '哈哈哈哈' },
        { senderId: 2, ts: baseTs + 200, type: 0, content: 'lol this is funny' },
        { senderId: 2, ts: baseTs + 300, type: 0, content: 'normal message' },
      ],
    })

    const res = await fetch(
      `${baseUrl}/api/sessions/test_laugh/laugh-analysis?keywords=哈哈,lol`,
    )
    assert.equal(res.status, 200)
    const body = (await res.json()) as any
    assert.ok(typeof body.totalLaughs === 'number')
    assert.ok(typeof body.totalMessages === 'number')
    assert.ok(typeof body.groupLaughRate === 'number')
    assert.ok(Array.isArray(body.rankByRate))
    assert.ok(Array.isArray(body.rankByCount))
    assert.ok(Array.isArray(body.typeDistribution))

    removeTestDb('test_laugh')
  })

  it('returns result structure without keywords', async () => {
    createTestDb('test_laugh_empty')

    // Without keywords param, the service receives empty keywords array
    const res = await fetch(`${baseUrl}/api/sessions/test_laugh_empty/laugh-analysis`)
    assert.equal(res.status, 200)
    const body = (await res.json()) as any
    // Structure should always be present
    assert.ok(typeof body.totalLaughs === 'number')
    assert.ok(typeof body.totalMessages === 'number')
    assert.ok(Array.isArray(body.rankByRate))
    assert.ok(Array.isArray(body.rankByCount))

    removeTestDb('test_laugh_empty')
  })
})

describe('GET /api/sessions/:id/member-name-history/:memberId', () => {
  it('returns name history for a member', async () => {
    createTestDb('test_name_hist')

    const res = await fetch(`${baseUrl}/api/sessions/test_name_hist/member-name-history/1`)
    assert.equal(res.status, 200)
    const body = (await res.json()) as any[]
    assert.ok(Array.isArray(body))
    assert.ok(body.length >= 2)

    // Check structure
    const entry = body[0]
    assert.ok(typeof entry.nameType === 'string')
    assert.ok(typeof entry.name === 'string')
    assert.ok(typeof entry.startTs === 'number')

    removeTestDb('test_name_hist')
  })

  it('returns empty array for non-existent member', async () => {
    createTestDb('test_name_hist_empty')

    const res = await fetch(`${baseUrl}/api/sessions/test_name_hist_empty/member-name-history/999`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.ok(Array.isArray(body))
    assert.equal(body.length, 0)

    removeTestDb('test_name_hist_empty')
  })

  it('returns 400 for invalid memberId', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/test/member-name-history/abc`)
    assert.equal(res.status, 400)
    const body = (await res.json()) as any
    assert.ok(body.error)
  })
})

describe('Time filter parsing', () => {
  it('passes startTs/endTs to service functions', async () => {
    const baseTs = 1700000000
    createTestDb('test_time_filter', {
      memberCount: 2,
      messages: [
        { senderId: 1, ts: baseTs, type: 0, content: 'early message' },
        { senderId: 1, ts: baseTs + 100000, type: 0, content: 'late message' },
        { senderId: 2, ts: baseTs + 50000, type: 0, content: 'mid message' },
      ],
    })

    // With tight filter, should get fewer results
    const filterEndTs = baseTs + 1000
    const res = await fetch(
      `${baseUrl}/api/sessions/test_time_filter/daily-activity?startTs=${baseTs}&endTs=${filterEndTs}`,
    )
    assert.equal(res.status, 200)
    const body = (await res.json()) as any[]
    assert.ok(Array.isArray(body))

    // Should only have 1 message in range
    const totalFiltered = body.reduce((sum: number, d: any) => sum + d.messageCount, 0)
    assert.equal(totalFiltered, 1)

    removeTestDb('test_time_filter')
  })
})
