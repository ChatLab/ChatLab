import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { checkConflictsFromSources, buildMergedOutput, serializeChatLabToJsonl } from '../index'
import { exportSessionToJson } from '../temp-db'
import type { MergerDataSource, MergerSourceMeta } from '../index'
import type { MergerMember, MergerMessage } from '@openchatlab/core'
import { CHATLAB_FORMAT_VERSION } from '@openchatlab/shared-types'
import { BetterSqliteAdapter } from '../../better-sqlite3-adapter'

function createMockSource(
  meta: MergerSourceMeta,
  members: MergerMember[],
  messages: MergerMessage[]
): MergerDataSource {
  return {
    getMeta: () => meta,
    getMembers: () => members,
    getMessageCount: () => messages.length,
    streamMessages: (_batchSize, callback) => callback(messages),
  }
}

describe('checkConflictsFromSources', () => {
  it('detects conflicts from different data sources', () => {
    const meta: MergerSourceMeta = { name: 'test', platform: 'qq', type: 'group' }
    const source1 = createMockSource(
      meta,
      [{ platformId: 'u1' }],
      [{ senderPlatformId: 'u1', timestamp: 100, type: 0, content: 'hello' }]
    )
    const source2 = createMockSource(
      meta,
      [{ platformId: 'u1' }],
      [{ senderPlatformId: 'u1', timestamp: 100, type: 0, content: 'world' }]
    )

    const result = checkConflictsFromSources([
      { source: source1, filename: 'a.txt' },
      { source: source2, filename: 'b.txt' },
    ])
    assert.equal(result.conflicts.length, 1)
  })

  it('no conflicts when messages are identical', () => {
    const meta: MergerSourceMeta = { name: 'test', platform: 'qq', type: 'group' }
    const source1 = createMockSource(
      meta,
      [{ platformId: 'u1' }],
      [{ senderPlatformId: 'u1', timestamp: 100, type: 0, content: 'same' }]
    )
    const source2 = createMockSource(
      meta,
      [{ platformId: 'u1' }],
      [{ senderPlatformId: 'u1', timestamp: 100, type: 0, content: 'same' }]
    )

    const result = checkConflictsFromSources([
      { source: source1, filename: 'a.txt' },
      { source: source2, filename: 'b.txt' },
    ])
    assert.equal(result.conflicts.length, 0)
  })
})

describe('buildMergedOutput', () => {
  it('merges from multiple sources and deduplicates', () => {
    const meta: MergerSourceMeta = { name: 'chat', platform: 'qq', type: 'group' }
    const source1 = createMockSource(
      meta,
      [{ platformId: 'u1', accountName: 'Alice' }],
      [
        { senderPlatformId: 'u1', timestamp: 100, type: 0, content: 'a' },
        { senderPlatformId: 'u1', timestamp: 200, type: 0, content: 'b' },
      ]
    )
    const source2 = createMockSource(
      meta,
      [
        { platformId: 'u1', accountName: 'Alice' },
        { platformId: 'u2', accountName: 'Bob' },
      ],
      [
        { senderPlatformId: 'u1', timestamp: 100, type: 0, content: 'a' },
        { senderPlatformId: 'u2', timestamp: 300, type: 0, content: 'c' },
      ]
    )

    const result = buildMergedOutput(
      [
        { source: source1, filename: 'file1.txt' },
        { source: source2, filename: 'file2.txt' },
      ],
      'TestMerge'
    )

    assert.ok(result.success)
    assert.equal(result.chatLabData.chatlab.version, CHATLAB_FORMAT_VERSION)
    assert.equal(result.chatLabData.messages.length, 3)
    assert.equal(result.chatLabData.messages[0].timestamp, 100)
    assert.equal(result.chatLabData.messages[1].timestamp, 200)
    assert.equal(result.chatLabData.messages[2].timestamp, 300)
    assert.equal(result.chatLabData.meta.name, 'TestMerge')
    assert.equal(result.chatLabData.meta.platform, 'qq')
    assert.equal(result.chatLabData.members.length, 2)
    assert.equal(result.chatLabData.meta.sources.length, 2)
  })

  it('detects mixed platform when sources differ', () => {
    const s1 = createMockSource(
      { name: 'a', platform: 'qq', type: 'group' },
      [{ platformId: 'u1' }],
      [{ senderPlatformId: 'u1', timestamp: 100, type: 0, content: 'x' }]
    )
    const s2 = createMockSource(
      { name: 'b', platform: 'wechat', type: 'group' },
      [{ platformId: 'u2' }],
      [{ senderPlatformId: 'u2', timestamp: 200, type: 0, content: 'y' }]
    )

    const result = buildMergedOutput(
      [
        { source: s1, filename: 'a.txt' },
        { source: s2, filename: 'b.txt' },
      ],
      'Cross'
    )
    assert.equal(result.chatLabData.meta.platform, 'mixed')
  })
})

describe('serializeChatLabToJsonl', () => {
  it('produces header, member, and message lines', () => {
    const data = buildMergedOutput(
      [
        {
          source: createMockSource(
            { name: 'test', platform: 'qq', type: 'group' },
            [{ platformId: 'u1' }],
            [{ senderPlatformId: 'u1', timestamp: 100, type: 0, content: 'hi' }]
          ),
          filename: 'f.txt',
        },
      ],
      'T'
    )

    const lines = [...serializeChatLabToJsonl(data.chatLabData)]
    assert.ok(lines.length >= 3)

    const header = JSON.parse(lines[0])
    assert.equal(header._type, 'header')
    assert.equal(header.chatlab.version, CHATLAB_FORMAT_VERSION)
    assert.ok(header.meta)

    const member = JSON.parse(lines[1])
    assert.equal(member._type, 'member')
    assert.equal(member.platformId, 'u1')

    const msg = JSON.parse(lines[2])
    assert.equal(msg._type, 'message')
    assert.equal(msg.content, 'hi')
  })
})

describe('exportSessionToJson', () => {
  it('uses the current ChatLab format version', () => {
    const rawDb = new Database(':memory:')
    rawDb.exec(`
      CREATE TABLE meta (
        name TEXT NOT NULL,
        platform TEXT NOT NULL,
        type TEXT NOT NULL,
        group_id TEXT,
        group_avatar TEXT
      );
      CREATE TABLE member (
        id INTEGER PRIMARY KEY,
        platform_id TEXT NOT NULL,
        account_name TEXT,
        group_nickname TEXT,
        avatar TEXT
      );
      CREATE TABLE message (
        sender_id INTEGER NOT NULL,
        sender_account_name TEXT,
        sender_group_nickname TEXT,
        ts INTEGER NOT NULL,
        type INTEGER NOT NULL,
        content TEXT
      );
      INSERT INTO meta (name, platform, type) VALUES ('Test', 'qq', 'group');
      INSERT INTO member (id, platform_id, account_name) VALUES (1, 'alice', 'Alice');
      INSERT INTO message (sender_id, sender_account_name, ts, type, content)
      VALUES (1, 'Alice', 100, 0, 'Hello');
    `)

    try {
      const exported = exportSessionToJson(new BetterSqliteAdapter(rawDb))
      assert.equal(exported.chatlab.version, CHATLAB_FORMAT_VERSION)
    } finally {
      rawDb.close()
    }
  })
})
