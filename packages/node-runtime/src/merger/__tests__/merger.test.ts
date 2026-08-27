import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {
  checkConflictsFromSources,
  buildMergedOutput,
  serializeChatLabToJsonl,
  type MergerInputMessage,
} from '../index'
import { exportSessionToJson } from '../temp-db'
import type { MergerDataSource, MergerSourceMeta } from '../index'
import type { MergerMember } from '@openchatlab/core'
import { CHATLAB_FORMAT_VERSION } from '@openchatlab/shared-types'
import { BetterSqliteAdapter } from '../../better-sqlite3-adapter'

function createMockSource(
  meta: MergerSourceMeta,
  members: MergerMember[],
  messages: MergerInputMessage[]
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

  it('preserves the maximum fallback occurrence count across overlapping sources', () => {
    const meta: MergerSourceMeta = { name: 'chat', platform: 'wechat', type: 'group', groupId: 'room' }
    const repeatedImage: MergerInputMessage = {
      senderPlatformId: 'u1',
      timestamp: 100,
      type: 1,
      content: '[图片]',
    }
    const source1 = createMockSource(
      meta,
      [{ platformId: 'u1', accountName: 'Alice' }],
      [{ ...repeatedImage }, { ...repeatedImage }]
    )
    const source2 = createMockSource(
      meta,
      [{ platformId: 'u1', accountName: 'Alice' }],
      [{ ...repeatedImage }, { ...repeatedImage }, { ...repeatedImage }]
    )

    const sources = [
      { source: source1, filename: 'first.json' },
      { source: source2, filename: 'overlap.json' },
    ]
    const result = buildMergedOutput(sources, 'Merged')
    const reversed = buildMergedOutput([...sources].reverse(), 'Merged')
    const conflicts = checkConflictsFromSources(sources)

    assert.equal(result.chatLabData.messages.length, 3)
    assert.equal(reversed.chatLabData.messages.length, 3)
    assert.equal(conflicts.totalMessages, 3)
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

  it('preserves the only non-empty owner id and drops conflicting owner ids', () => {
    const messages = [{ senderPlatformId: 'peer', timestamp: 100, type: 0, content: 'hello' }]
    const members = [{ platformId: 'owner' }, { platformId: 'peer' }]
    const sourceWithoutOwner = createMockSource({ name: 'Private', platform: 'qq', type: 'private' }, members, messages)
    const sourceWithOwner = createMockSource(
      { name: 'Private', platform: 'qq', type: 'private', ownerId: 'owner' } as MergerSourceMeta & {
        ownerId: string
      },
      members,
      messages
    )

    const retained = buildMergedOutput(
      [
        { source: sourceWithoutOwner, filename: 'without-owner.json' },
        { source: sourceWithOwner, filename: 'with-owner.json' },
      ],
      'Merged'
    )
    assert.equal((retained.chatLabData.meta as { ownerId?: string }).ownerId, 'owner')

    const invalid = buildMergedOutput(
      [
        {
          source: createMockSource(
            { name: 'Private', platform: 'qq', type: 'private', ownerId: 'missing-owner' },
            members,
            messages
          ),
          filename: 'invalid-owner.json',
        },
      ],
      'Merged'
    )
    assert.equal((invalid.chatLabData.meta as { ownerId?: string }).ownerId, undefined)

    const conflicting = buildMergedOutput(
      [
        { source: sourceWithOwner, filename: 'first.json' },
        {
          source: createMockSource(
            { name: 'Private', platform: 'qq', type: 'private', ownerId: 'different-owner' } as MergerSourceMeta & {
              ownerId: string
            },
            members,
            messages
          ),
          filename: 'second.json',
        },
      ],
      'Merged'
    )
    assert.equal((conflicting.chatLabData.meta as { ownerId?: string }).ownerId, undefined)
  })

  it('keeps same-platform message IDs separate across unrelated private chats', () => {
    const first = createMockSource(
      { name: 'Alice', platform: 'telegram', type: 'private' },
      [{ platformId: 'owner' }, { platformId: 'alice' }],
      [
        {
          platformMessageId: '1',
          senderPlatformId: 'alice',
          timestamp: 100,
          type: 0,
          content: 'first chat',
        },
      ]
    )
    const second = createMockSource(
      { name: 'Bob', platform: 'telegram', type: 'private' },
      [{ platformId: 'owner' }, { platformId: 'bob' }],
      [
        {
          platformMessageId: '1',
          senderPlatformId: 'bob',
          timestamp: 200,
          type: 0,
          content: 'second chat',
        },
      ]
    )

    const result = buildMergedOutput(
      [
        { source: first, filename: 'alice.json' },
        { source: second, filename: 'bob.json' },
      ],
      'Merged'
    )

    const conflicts = checkConflictsFromSources([
      { source: first, filename: 'alice.json' },
      { source: second, filename: 'bob.json' },
    ])
    assert.equal(conflicts.totalMessages, 2)
    assert.equal(result.chatLabData.messages.length, 2)
    assert.equal(new Set(result.chatLabData.messages.map((message) => message.platformMessageId)).size, 2)
  })

  it('keeps ambiguous one-member private chats source-local without verified overlap', () => {
    const first = createMockSource(
      { name: 'Alice', platform: 'telegram', type: 'private' },
      [{ platformId: 'owner' }],
      [
        {
          platformMessageId: '1',
          senderPlatformId: 'owner',
          timestamp: 100,
          type: 0,
          content: 'first chat',
        },
      ]
    )
    const second = createMockSource(
      { name: 'Bob', platform: 'telegram', type: 'private' },
      [{ platformId: 'owner' }],
      [
        {
          platformMessageId: '1',
          senderPlatformId: 'owner',
          timestamp: 200,
          type: 0,
          content: 'second chat',
        },
      ]
    )
    const sources = [
      { source: first, filename: 'alice.json' },
      { source: second, filename: 'bob.json' },
    ]

    const conflicts = checkConflictsFromSources(sources)
    const result = buildMergedOutput(sources, 'Merged')

    assert.equal(conflicts.totalMessages, 2)
    assert.equal(result.chatLabData.messages.length, 2)
    assert.equal(new Set(result.chatLabData.messages.map((message) => message.platformMessageId)).size, 2)
  })

  it('deduplicates overlapping private exports when their observed members differ', () => {
    const meta: MergerSourceMeta = { name: 'Alice', platform: 'qq', type: 'private' }
    const sharedMessage: MergerInputMessage = {
      platformMessageId: 'message-1',
      senderPlatformId: 'alice',
      timestamp: 100,
      type: 0,
      content: 'shared',
    }
    const incomingOnly = createMockSource(meta, [{ platformId: 'alice' }], [sharedMessage])
    const bothSides = createMockSource(
      meta,
      [{ platformId: 'owner' }, { platformId: 'alice' }],
      [
        sharedMessage,
        {
          platformMessageId: 'message-2',
          senderPlatformId: 'owner',
          timestamp: 200,
          type: 0,
          content: 'reply',
        },
      ]
    )
    const sources = [
      { source: incomingOnly, filename: 'old.json' },
      { source: bothSides, filename: 'new.json' },
    ]

    const conflicts = checkConflictsFromSources(sources)
    const result = buildMergedOutput(sources, 'Merged')

    assert.equal(conflicts.totalMessages, 2)
    assert.equal(result.chatLabData.messages.length, 2)
    assert.deepEqual(
      result.chatLabData.messages.map((message) => message.platformMessageId),
      ['message-1', 'message-2']
    )
  })

  it('deduplicates the same group when a newer export has a different name and more members', () => {
    const oldMeta: MergerSourceMeta = { name: 'Old project', platform: 'qq', type: 'group' }
    const newMeta: MergerSourceMeta = { name: 'Renamed project', platform: 'qq', type: 'group' }
    const sharedMessage: MergerInputMessage = {
      platformMessageId: 'message-1',
      senderPlatformId: 'alice',
      timestamp: 100,
      type: 0,
      content: 'shared',
    }
    const oldExport = createMockSource(oldMeta, [{ platformId: 'alice' }, { platformId: 'bob' }], [sharedMessage])
    const newExport = createMockSource(
      newMeta,
      [{ platformId: 'alice' }, { platformId: 'bob' }, { platformId: 'carol' }],
      [
        sharedMessage,
        {
          platformMessageId: 'message-2',
          replyToMessageId: 'message-1',
          senderPlatformId: 'carol',
          timestamp: 200,
          type: 0,
          content: 'new',
        },
      ]
    )
    const sources = [
      { source: oldExport, filename: 'old.json' },
      { source: newExport, filename: 'new.json' },
    ]

    const conflicts = checkConflictsFromSources(sources)
    const result = buildMergedOutput(sources, 'Merged')

    assert.equal(conflicts.totalMessages, 2)
    assert.equal(result.chatLabData.messages.length, 2)
    assert.deepEqual(
      result.chatLabData.messages.map((message) => message.platformMessageId),
      ['message-1', 'message-2']
    )
    assert.equal(result.chatLabData.messages[1].replyToMessageId, result.chatLabData.messages[0].platformMessageId)
  })

  it('keeps the same message ID separate across unrelated groups with the same name', () => {
    const meta: MergerSourceMeta = { name: 'Project', platform: 'qq', type: 'group' }
    const first = createMockSource(
      meta,
      [{ platformId: 'alice' }],
      [
        {
          platformMessageId: 'message-1',
          senderPlatformId: 'alice',
          timestamp: 100,
          type: 0,
          content: 'first group',
        },
      ]
    )
    const second = createMockSource(
      meta,
      [{ platformId: 'bob' }],
      [
        {
          platformMessageId: 'message-1',
          senderPlatformId: 'bob',
          timestamp: 200,
          type: 0,
          content: 'second group',
        },
      ]
    )
    const sources = [
      { source: first, filename: 'first.json' },
      { source: second, filename: 'second.json' },
    ]

    const conflicts = checkConflictsFromSources(sources)
    const result = buildMergedOutput(sources, 'Merged')

    assert.equal(conflicts.totalMessages, 2)
    assert.equal(result.chatLabData.messages.length, 2)
    assert.equal(new Set(result.chatLabData.messages.map((message) => message.platformMessageId)).size, 2)
  })

  it('backfills a stable ID when an ID-bearing copy bridges a fallback-only message', () => {
    const meta: MergerSourceMeta = { name: 'Chat', platform: 'qq', type: 'private' }
    const members = [{ platformId: 'owner' }, { platformId: 'alice' }, { platformId: 'bob' }]
    const fallbackSource = createMockSource(meta, members, [
      { senderPlatformId: 'alice', timestamp: 100, type: 0, content: 'root' },
    ])
    const idSource = createMockSource(meta, members, [
      {
        platformMessageId: 'message-1',
        senderPlatformId: 'alice',
        timestamp: 100,
        type: 0,
        content: 'root',
      },
      {
        platformMessageId: 'message-2',
        replyToMessageId: 'message-1',
        senderPlatformId: 'bob',
        timestamp: 101,
        type: 0,
        content: 'reply',
      },
    ])

    const result = buildMergedOutput(
      [
        { source: fallbackSource, filename: 'old.json' },
        { source: idSource, filename: 'new.json' },
      ],
      'Merged'
    )

    assert.equal(result.chatLabData.messages.length, 2)
    const root = result.chatLabData.messages.find((message) => message.content === 'root')
    const reply = result.chatLabData.messages.find((message) => message.content === 'reply')
    assert.equal(root?.platformMessageId, 'message-1')
    assert.equal(reply?.replyToMessageId, root?.platformMessageId)
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
        group_avatar TEXT,
        owner_id TEXT
      );
      CREATE TABLE member (
        id INTEGER PRIMARY KEY,
        platform_id TEXT NOT NULL,
        account_name TEXT,
        group_nickname TEXT,
        avatar TEXT
      );
      CREATE TABLE message (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER NOT NULL,
        sender_account_name TEXT,
        sender_group_nickname TEXT,
        ts INTEGER NOT NULL,
        type INTEGER NOT NULL,
        content TEXT,
        platform_message_id TEXT,
        reply_to_message_id TEXT
      );
      INSERT INTO meta (name, platform, type, owner_id) VALUES ('Test', 'qq', 'private', 'owner');
      INSERT INTO member (id, platform_id, account_name) VALUES (1, 'alice', 'Alice');
      INSERT INTO message (
        sender_id, sender_account_name, ts, type, content, platform_message_id, reply_to_message_id
      ) VALUES (1, 'Alice', 100, 0, 'Hello', 'message-1', 'message-0');
    `)

    try {
      const exported = exportSessionToJson(new BetterSqliteAdapter(rawDb))
      assert.equal(exported.chatlab.version, CHATLAB_FORMAT_VERSION)
      assert.equal((exported.meta as { ownerId?: string }).ownerId, 'owner')
      assert.equal(exported.messages[0].platformMessageId, 'message-1')
      assert.equal(exported.messages[0].replyToMessageId, 'message-0')
    } finally {
      rawDb.close()
    }
  })
})
