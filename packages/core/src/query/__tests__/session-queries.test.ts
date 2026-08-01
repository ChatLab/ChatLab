/**
 * Behavior tests for session query functions.
 *
 * Run: npx tsx --test packages/core/src/query/__tests__/session-queries.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CHAT_DB_TABLES } from '../../schema'
import {
  buildSessionInfo,
  getChatOverview,
  getLastPlatformMessageId,
  getSessionInfo,
  getSummaryCount,
  type SessionMeta,
  type SessionOverview,
} from '../session-queries'
import { SqliteTestAdapter } from './sqlite-test-adapter'

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

function createSessionDb(): SqliteTestAdapter {
  const db = new SqliteTestAdapter()
  db.exec(CHAT_DB_TABLES)
  db.exec(`
    INSERT INTO meta (name, platform, type, imported_at, group_id, owner_id)
    VALUES ('Chat', 'telegram', 'group', 1700000000, 'g001', 'me');
    INSERT INTO member (id, platform_id, account_name) VALUES
      (1, 'alice', 'Alice'),
      (2, 'bob', 'Bob'),
      (99, 'system', '系统消息');
    INSERT INTO message (id, sender_id, ts, type, content, platform_message_id) VALUES
      (1, 1, 100, 0, 'one', 'pm-1'),
      (2, 1, 300, 0, 'three', 'pm-3'),
      (3, 2, 200, 0, 'two', NULL);
    INSERT INTO segment (start_ts, end_ts, message_count, summary) VALUES
      (100, 150, 1, 'summary one'),
      (200, 250, 1, NULL),
      (300, 350, 1, 'summary two');
  `)
  return db
}

describe('buildSessionInfo', () => {
  it('composes meta and overview into flat session info', () => {
    const info = buildSessionInfo(makeMeta(), makeOverview(), 3)

    assert.deepEqual(info, {
      name: 'Test Group',
      platform: 'wechat',
      type: 'group',
      importedAt: 1700000000,
      messageCount: 500,
      memberCount: 10,
      groupId: 'g001',
      groupAvatar: null,
      ownerId: 'u001',
      firstMessageTs: 1600000000,
      lastMessageTs: 1700000000,
      summaryCount: 3,
    })
  })

  it('defaults summary count and preserves empty timestamp bounds', () => {
    const info = buildSessionInfo(makeMeta(), makeOverview({ firstMessageTs: null, lastMessageTs: null }))
    assert.deepEqual([info.summaryCount, info.firstMessageTs, info.lastMessageTs], [0, null, null])
  })
})

describe('session database queries', () => {
  it('returns null when metadata is absent', () => {
    const db = new SqliteTestAdapter()
    db.exec(CHAT_DB_TABLES)

    assert.equal(getSessionInfo(db), null)
    db.close()
  })

  it('combines persisted metadata, aggregate counts, and summary count', () => {
    const db = createSessionDb()
    const info = getSessionInfo(db)

    assert.ok(info)
    assert.deepEqual(
      {
        name: info.name,
        platform: info.platform,
        ownerId: info.ownerId,
        messageCount: info.messageCount,
        memberCount: info.memberCount,
        firstMessageTs: info.firstMessageTs,
        lastMessageTs: info.lastMessageTs,
        summaryCount: info.summaryCount,
      },
      {
        name: 'Chat',
        platform: 'telegram',
        ownerId: 'me',
        messageCount: 3,
        memberCount: 2,
        firstMessageTs: 100,
        lastMessageTs: 300,
        summaryCount: 2,
      }
    )
    db.close()
  })

  it('returns overview members ordered by real message activity', () => {
    const db = createSessionDb()
    const overview = getChatOverview(db, 1)

    assert.ok(overview)
    assert.equal(overview.summaryCount, 2)
    assert.deepEqual(overview.topMembers, [{ id: 1, name: 'Alice', count: 2 }])
    db.close()
  })

  it('handles summary tables and incremental message ids', () => {
    const db = createSessionDb()

    assert.equal(getSummaryCount(db), 2)
    assert.equal(getLastPlatformMessageId(db), 'pm-3')

    db.exec('DROP TABLE segment')
    assert.equal(getSummaryCount(db), 0)
    db.exec('UPDATE message SET platform_message_id = NULL')
    assert.equal(getLastPlatformMessageId(db), null)
    db.close()
  })
})
