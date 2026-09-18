import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CHAT_DB_SCHEMA } from '../schema'
import { SqliteTestAdapter } from './__tests__/sqlite-test-adapter'
import { resolvePrivateChatParticipants, type PrivateChatParticipantsResult } from './private-participants'

/** A WeChat private chat lists the people of forwarded chat records as members too (carol, dave). */
const MEMBERS: Array<[number, string, string]> = [
  [1, 'alice', 'Alice'],
  [2, 'bob', 'Bob'],
  [3, 'system', '系统消息'],
  [4, 'carol', 'Carol'],
  [5, 'dave', 'Dave'],
]

function createChat(type: string, ownerId: string | null, messageCounts: Record<number, number>): SqliteTestAdapter {
  const db = new SqliteTestAdapter()
  db.exec(CHAT_DB_SCHEMA)
  db.prepare("INSERT INTO meta (name, platform, type, imported_at, owner_id) VALUES ('Chat', 'weixin', ?, 0, ?)").run(
    type,
    ownerId
  )
  const member = db.prepare('INSERT INTO member (id, platform_id, account_name) VALUES (?, ?, ?)')
  for (const row of MEMBERS) member.run(...row)
  const insert = db.prepare("INSERT INTO message (sender_id, ts, type, content) VALUES (?, ?, 0, 'hi')")
  let ts = 1_786_200_000
  for (const [senderId, count] of Object.entries(messageCounts)) {
    for (let i = 0; i < count; i++) insert.run(Number(senderId), ts++)
  }
  return db
}

/** [memberId, isOwner, messageCount] per participant, or the failure reason. */
function summarize(result: PrivateChatParticipantsResult) {
  return result.ok
    ? result.participants.map((participant) => [participant.memberId, participant.isOwner, participant.messageCount])
    : result.reason
}

describe('resolvePrivateChatParticipants', () => {
  const cases: Array<{
    name: string
    type?: string
    ownerId: string | null
    messageCounts: Record<number, number>
    expected: ReturnType<typeof summarize>
  }> = [
    {
      name: 'keeps the owner and the other sender with the most messages',
      ownerId: 'alice',
      // carol, a third sender, wrote more than the owner and is still left out.
      messageCounts: { 2: 4, 4: 3, 1: 1, 3: 9 },
      expected: [
        [1, true, 1],
        [2, false, 4],
      ],
    },
    {
      name: 'without an owner keeps the two senders with the most messages, ties going to the lower member id',
      ownerId: null,
      messageCounts: { 2: 4, 4: 2, 1: 2 },
      expected: [
        [1, false, 2],
        [2, false, 4],
      ],
    },
    {
      name: 'an owner who never wrote here does not count as a speaker',
      ownerId: 'dave',
      messageCounts: { 1: 2, 2: 1, 4: 1 },
      expected: [
        [1, false, 2],
        [2, false, 1],
      ],
    },
    {
      name: 'a private chat where only one member row wrote',
      ownerId: 'alice',
      messageCounts: { 1: 5, 3: 2 },
      expected: 'fewer_than_two_speakers',
    },
    {
      name: 'a group chat',
      type: 'group',
      ownerId: 'alice',
      messageCounts: { 1: 2, 2: 2 },
      expected: 'not_private_chat',
    },
  ]

  for (const { name, type = 'private', ownerId, messageCounts, expected } of cases) {
    it(name, () => {
      const db = createChat(type, ownerId, messageCounts)
      try {
        assert.deepEqual(summarize(resolvePrivateChatParticipants(db)), expected)
      } finally {
        db.close()
      }
    })
  }

  it('returns the display name and platform id of both participants', () => {
    const db = createChat('private', 'alice', { 1: 1, 2: 1 })
    try {
      assert.deepEqual(resolvePrivateChatParticipants(db), {
        ok: true,
        participants: [
          { memberId: 1, name: 'Alice', platformId: 'alice', isOwner: true, messageCount: 1 },
          { memberId: 2, name: 'Bob', platformId: 'bob', isOwner: false, messageCount: 1 },
        ],
      })
    } finally {
      db.close()
    }
  })
})
