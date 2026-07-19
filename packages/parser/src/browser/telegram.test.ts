import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ChatType, KNOWN_PLATFORMS, MessageType } from '@openchatlab/shared-types'

import {
  detectTelegramMultiChatJson,
  detectTelegramSingleJson,
  parseTelegramMultiChatJson,
  parseTelegramSingleJson,
  scanTelegramChatsJson,
} from './telegram'

describe('Telegram browser-safe single-chat parser', () => {
  it('parses mixed text, media, service messages, replies, and skips invalid timestamps', async () => {
    const content = JSON.stringify({
      name: 'Project Team',
      type: 'private_group',
      id: 4242,
      messages: [
        {
          id: 1,
          type: 'message',
          date: '2024-01-02T03:04:05',
          date_unixtime: '1704164645',
          from: 'Alice',
          from_id: 'user10001',
          text: ['hello ', { type: 'bold', text: 'telegram' }],
        },
        {
          id: 2,
          type: 'message',
          date: '2024-01-02T03:05:06',
          date_unixtime: '1704164706',
          from: 'Bob',
          from_id: 'user10002',
          text: 'caption',
          photo: 'photos/photo_1.jpg',
          reply_to_message_id: 1,
        },
        {
          id: 3,
          type: 'service',
          date: '2024-01-02T03:06:07',
          date_unixtime: '1704164767',
          actor: 'Bob',
          actor_id: 'user10002',
          action: 'invite_members',
          members: ['Carol'],
          text: '',
        },
        {
          id: 4,
          type: 'message',
          date: 'invalid',
          date_unixtime: 'invalid',
          from: 'Nobody',
          from_id: 'user99999',
          text: 'skip me',
        },
      ],
    })

    assert.equal(detectTelegramSingleJson(content, 'result.json'), true)
    assert.equal(
      detectTelegramSingleJson(
        JSON.stringify({ chatlab: { version: '1' }, meta: {}, members: [], messages: [] }),
        'chatlab.json'
      ),
      false
    )
    assert.equal(
      detectTelegramSingleJson(
        JSON.stringify({ about: 'Telegram Desktop', chats: { list: [{ name: 'Project Team', messages: [] }] } }),
        'result.json'
      ),
      false
    )

    const result = await parseTelegramSingleJson(content)

    assert.deepEqual(result.meta, {
      name: 'Project Team',
      platform: KNOWN_PLATFORMS.TELEGRAM,
      type: ChatType.GROUP,
      groupId: '4242',
    })
    assert.deepEqual(result.members, [
      { platformId: '10001', accountName: 'Alice' },
      { platformId: '10002', accountName: 'Bob' },
      { platformId: '99999', accountName: 'Nobody' },
    ])
    assert.deepEqual(result.messages, [
      {
        platformMessageId: '1',
        senderPlatformId: '10001',
        senderAccountName: 'Alice',
        timestamp: 1704164645,
        type: MessageType.TEXT,
        content: 'hello telegram',
        replyToMessageId: undefined,
      },
      {
        platformMessageId: '2',
        senderPlatformId: '10002',
        senderAccountName: 'Bob',
        timestamp: 1704164706,
        type: MessageType.IMAGE,
        content: '[photo] caption',
        replyToMessageId: '1',
      },
      {
        platformMessageId: '3',
        senderPlatformId: '10002',
        senderAccountName: 'Bob',
        timestamp: 1704164767,
        type: MessageType.SYSTEM,
        content: '[invite_members] Carol',
        replyToMessageId: undefined,
      },
    ])
  })

  it('supports private chats and observes cooperative cancellation', async () => {
    const content = JSON.stringify({
      name: 'Alice',
      type: 'personal_chat',
      id: 10001,
      messages: Array.from({ length: 1001 }, (_, index) => ({
        id: index + 1,
        type: 'message',
        date: '2024-01-02T03:04:05',
        date_unixtime: String(1_704_164_645 + index),
        from: 'Alice',
        from_id: 'user10001',
        text: `message ${index}`,
      })),
    })
    let checks = 0

    const result = await parseTelegramSingleJson(content, {
      checkCancelled: () => {
        checks += 1
      },
      yieldEvery: 100,
    })

    assert.equal(result.meta.type, ChatType.PRIVATE)
    assert.equal(result.meta.groupId, undefined)
    assert.equal(result.messages.length, 1001)
    assert.ok(checks > 10)
  })

  it('rejects malformed or non-chat JSON instead of creating an empty session', async () => {
    await assert.rejects(parseTelegramSingleJson('{'), /Invalid Telegram single-chat JSON export/)
    await assert.rejects(parseTelegramSingleJson(JSON.stringify({ name: 'No messages' })), /Invalid Telegram/)
  })

  it('uses an English fallback identity for service messages without an actor', async () => {
    const result = await parseTelegramSingleJson(
      JSON.stringify({
        name: 'System Events',
        type: 'private_group',
        id: 4242,
        messages: [
          {
            id: 1,
            type: 'service',
            date: '2024-01-02T03:04:05',
            date_unixtime: '1704164645',
            action: 'create_group',
            text: '',
          },
        ],
      })
    )

    assert.equal(result.messages[0].senderAccountName, 'System')
  })
})

describe('Telegram browser-safe multi-chat parser', () => {
  const fixture = JSON.stringify({
    about: 'This file was exported by Telegram Desktop.',
    chats: {
      list: [
        {
          name: 'Alice',
          type: 'personal_chat',
          id: 10001,
          messages: [
            {
              id: 1,
              type: 'message',
              date: '2024-01-02T03:04:05',
              date_unixtime: '1704164645',
              from: 'Alice',
              from_id: 'user10001',
              text: 'hello alice',
            },
          ],
        },
        {
          name: 'Project Team',
          type: 'private_group',
          id: 4242,
          messages: [
            {
              id: 2,
              type: 'message',
              date: '2024-01-02T03:05:06',
              date_unixtime: '1704164706',
              from: 'Bob',
              from_id: 'user10002',
              text: ['hello ', { type: 'bold', text: 'team' }],
            },
            {
              id: 3,
              type: 'service',
              date: '2024-01-02T03:06:07',
              date_unixtime: '1704164767',
              actor: 'Bob',
              actor_id: 'user10002',
              action: 'invite_members',
              members: ['Carol'],
              text: '',
            },
          ],
        },
      ],
    },
  })

  it('detects a full export without misclassifying it as a single-chat export', () => {
    assert.equal(detectTelegramMultiChatJson(fixture, 'result.json'), true)
    assert.equal(detectTelegramSingleJson(fixture, 'result.json'), false)
    const delayedChats = JSON.stringify({
      about: 'This file was exported by Telegram Desktop.',
      profile_metadata: 'x'.repeat(70 * 1024),
      chats: { list: [] },
    })
    assert.equal(detectTelegramMultiChatJson(delayedChats.slice(0, 64 * 1024), 'result.json'), true)
    assert.equal(
      detectTelegramMultiChatJson(
        JSON.stringify({ name: 'Alice', type: 'personal_chat', id: 10001, messages: [] }),
        'result.json'
      ),
      false
    )
  })

  it('scans chat metadata and parses only the selected chat', async () => {
    assert.deepEqual(await scanTelegramChatsJson(fixture), [
      { index: 0, name: 'Alice', type: 'personal_chat', id: 10001, messageCount: 1 },
      { index: 1, name: 'Project Team', type: 'private_group', id: 4242, messageCount: 2 },
    ])

    const result = await parseTelegramMultiChatJson(fixture, 1)
    assert.deepEqual(result.meta, {
      name: 'Project Team',
      platform: KNOWN_PLATFORMS.TELEGRAM,
      type: ChatType.GROUP,
      groupId: '4242',
    })
    assert.deepEqual(result.members, [{ platformId: '10002', accountName: 'Bob' }])
    assert.deepEqual(
      result.messages.map((message) => ({ id: message.platformMessageId, content: message.content })),
      [
        { id: '2', content: 'hello team' },
        { id: '3', content: '[invite_members] Carol' },
      ]
    )
  })

  it('rejects invalid exports and indexes and observes cooperative cancellation', async () => {
    await assert.rejects(scanTelegramChatsJson('{'), /Invalid Telegram full export JSON/)
    await assert.rejects(parseTelegramMultiChatJson(fixture, -1), /chat index/i)
    await assert.rejects(parseTelegramMultiChatJson(fixture, 2), /chat index/i)

    let checks = 0
    await assert.rejects(
      scanTelegramChatsJson(fixture, {
        checkCancelled: () => {
          checks += 1
          if (checks === 2) throw new Error('cancelled')
        },
        yieldEvery: 1,
      }),
      /cancelled/
    )
    assert.equal(checks, 2)
  })
})
