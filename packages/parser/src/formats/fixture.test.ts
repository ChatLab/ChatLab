import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it } from 'node:test'
import { ChatType, KNOWN_PLATFORMS, MessageType } from '@openchatlab/shared-types'

import { detectFormat, parseFileSync } from '../index'
import type { ParseResult } from '../types'

interface ParserFixture {
  filename: string
  content: string
  formatId: string
  expected: {
    meta: {
      name: string
      platform: string
      type: ChatType
    }
    memberIds: string[]
    messages: Array<{
      senderPlatformId: string
      timestamp: number
      type: MessageType
      content: string | null
    }>
  }
}

function localTs(isoLocal: string): number {
  return Math.floor(new Date(isoLocal).getTime() / 1000)
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function jsonLine(value: unknown): string {
  return JSON.stringify(value)
}

async function parseFixture(fixture: ParserFixture): Promise<ParseResult> {
  const dir = mkdtempSync(join(tmpdir(), 'chatlab-parser-fixture-'))
  try {
    const filePath = join(dir, fixture.filename)
    writeFileSync(filePath, fixture.content, 'utf-8')

    assert.equal(detectFormat(filePath)?.id, fixture.formatId)
    return await parseFileSync(filePath)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const fixtures: ParserFixture[] = [
  {
    filename: 'qq-group.txt',
    content: [
      '消息记录（此消息记录为文本格式，不支持重新导入）',
      '消息对象:测试 QQ 群',
      '2024-01-02 03:04:05 Alice(10001)',
      'hello qq',
      '2024-01-02 03:05:06 Bob(10002)',
      '[图片]',
      '',
    ].join('\n'),
    formatId: 'qq-native-txt',
    expected: {
      meta: { name: '测试 QQ 群', platform: KNOWN_PLATFORMS.QQ, type: ChatType.GROUP },
      memberIds: ['10001', '10002'],
      messages: [
        {
          senderPlatformId: '10001',
          timestamp: localTs('2024-01-02T03:04:05'),
          type: MessageType.TEXT,
          content: 'hello qq',
        },
        {
          senderPlatformId: '10002',
          timestamp: localTs('2024-01-02T03:05:06'),
          type: MessageType.IMAGE,
          content: '[图片]',
        },
      ],
    },
  },
  {
    filename: 'weflow.json',
    content: json({
      weflow: { version: '1.0.0', exportedAt: 1704164645 },
      session: {
        wxid: 'room@chatroom',
        nickname: '微信测试群',
        remark: '',
        displayName: '微信测试群',
        type: '群聊',
        lastTimestamp: 1704164706,
        messageCount: 2,
      },
      avatars: {},
      messages: [
        {
          localId: 1,
          createTime: 1704164645,
          formattedTime: '2024-01-02 03:04:05',
          type: '文本消息',
          localType: 1,
          content: 'hello wechat',
          isSend: 0,
          senderUsername: 'wxid_alice',
          senderDisplayName: 'Alice',
          senderAvatarKey: 'wxid_alice',
          source: '',
        },
        {
          localId: 2,
          createTime: 1704164706,
          formattedTime: '2024-01-02 03:05:06',
          type: '图片消息',
          localType: 3,
          content: '[图片]',
          isSend: 1,
          senderUsername: 'wxid_bob',
          senderDisplayName: 'Bob',
          senderAvatarKey: 'wxid_bob',
          source: '',
        },
      ],
    }),
    formatId: 'weflow',
    expected: {
      meta: { name: '微信测试群', platform: KNOWN_PLATFORMS.WECHAT, type: ChatType.GROUP },
      memberIds: ['wxid_alice', 'wxid_bob'],
      messages: [
        {
          senderPlatformId: 'wxid_alice',
          timestamp: 1704164645,
          type: MessageType.TEXT,
          content: 'hello wechat',
        },
        {
          senderPlatformId: 'wxid_bob',
          timestamp: 1704164706,
          type: MessageType.IMAGE,
          content: '[图片]',
        },
      ],
    },
  },
  {
    filename: 'telegram.json',
    content: json({
      name: 'Telegram Test Chat',
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
          text: 'hello telegram',
          text_entities: [{ type: 'plain', text: 'hello telegram' }],
        },
      ],
    }),
    formatId: 'telegram-native-single',
    expected: {
      meta: { name: 'Telegram Test Chat', platform: KNOWN_PLATFORMS.TELEGRAM, type: ChatType.GROUP },
      memberIds: ['10001'],
      messages: [
        {
          senderPlatformId: '10001',
          timestamp: 1704164645,
          type: MessageType.TEXT,
          content: 'hello telegram',
        },
      ],
    },
  },
  {
    filename: '与Alice的 WhatsApp 聊天.txt',
    content: [
      'Messages and calls are end-to-end encrypted.',
      '2024/01/02 03:04 - Alice: hello whatsapp',
      '2024/01/02 03:05:06 PM - Bob: image omitted',
      '2024/01/02 03:06:07 P.M. - Bob: image omitted',
      '',
    ].join('\n'),
    formatId: 'whatsapp-native-txt',
    expected: {
      meta: { name: 'Alice', platform: KNOWN_PLATFORMS.WHATSAPP, type: ChatType.PRIVATE },
      memberIds: ['Alice', 'Bob'],
      messages: [
        {
          senderPlatformId: 'Alice',
          timestamp: localTs('2024-01-02T03:04:00'),
          type: MessageType.TEXT,
          content: 'hello whatsapp',
        },
        {
          senderPlatformId: 'Bob',
          timestamp: localTs('2024-01-02T15:05:06'),
          type: MessageType.IMAGE,
          content: 'image omitted',
        },
        {
          senderPlatformId: 'Bob',
          timestamp: localTs('2024-01-02T15:06:07'),
          type: MessageType.IMAGE,
          content: 'image omitted',
        },
      ],
    },
  },
  {
    filename: '_chat.txt',
    content: [
      '[2026/7/9 23:39:03] Messages and calls are end-to-end encrypted.',
      '[2026/7/9 02:28:09] Alice: Hey',
      '[2026/7/9 02:28:37] Bob:Hi without sender-space',
      '',
    ].join('\n'),
    formatId: 'whatsapp-native-txt',
    expected: {
      meta: { name: 'Alice', platform: KNOWN_PLATFORMS.WHATSAPP, type: ChatType.PRIVATE },
      memberIds: ['Alice', 'Bob'],
      messages: [
        {
          senderPlatformId: 'system',
          timestamp: localTs('2026-07-09T23:39:03'),
          type: MessageType.SYSTEM,
          content: 'Messages and calls are end-to-end encrypted.',
        },
        {
          senderPlatformId: 'Alice',
          timestamp: localTs('2026-07-09T02:28:09'),
          type: MessageType.TEXT,
          content: 'Hey',
        },
        {
          senderPlatformId: 'Bob',
          timestamp: localTs('2026-07-09T02:28:37'),
          type: MessageType.TEXT,
          content: 'Hi without sender-space',
        },
      ],
    },
  },
  {
    filename: 'chatlab.json',
    content: json({
      chatlab: { version: '1.0.0', exportedAt: 1704164645 },
      meta: { name: 'ChatLab JSON 群', platform: 'qq', type: 'group' },
      members: [
        { platformId: 'u1', accountName: 'Alice', groupNickname: 'A' },
        { platformId: 'u2', accountName: 'Bob', groupNickname: 'B' },
      ],
      messages: [
        {
          sender: 'u1',
          accountName: 'Alice',
          groupNickname: 'A',
          timestamp: 1704164645,
          type: MessageType.TEXT,
          content: 'hello chatlab json',
        },
      ],
    }),
    formatId: 'chatlab',
    expected: {
      meta: { name: 'ChatLab JSON 群', platform: KNOWN_PLATFORMS.QQ, type: ChatType.GROUP },
      memberIds: ['u1', 'u2'],
      messages: [
        {
          senderPlatformId: 'u1',
          timestamp: 1704164645,
          type: MessageType.TEXT,
          content: 'hello chatlab json',
        },
      ],
    },
  },
  {
    filename: 'chatlab.jsonl',
    content: [
      jsonLine({
        _type: 'header',
        chatlab: { version: '1.0.0', exportedAt: 1704164645 },
        meta: { name: 'ChatLab JSONL 群', platform: 'telegram', type: 'group' },
      }),
      jsonLine({ _type: 'member', platformId: 'tg1', accountName: 'Alice' }),
      jsonLine({
        _type: 'message',
        sender: 'tg1',
        accountName: 'Alice',
        timestamp: 1704164645,
        type: MessageType.TEXT,
        content: 'hello chatlab jsonl',
      }),
      '',
    ].join('\n'),
    formatId: 'chatlab-jsonl',
    expected: {
      meta: { name: 'ChatLab JSONL 群', platform: KNOWN_PLATFORMS.TELEGRAM, type: ChatType.GROUP },
      memberIds: ['tg1'],
      messages: [
        {
          senderPlatformId: 'tg1',
          timestamp: 1704164645,
          type: MessageType.TEXT,
          content: 'hello chatlab jsonl',
        },
      ],
    },
  },
]

describe('parser representative format fixtures', () => {
  for (const fixture of fixtures) {
    it(`detects and parses ${fixture.formatId}`, async () => {
      const result = await parseFixture(fixture)

      assert.deepEqual(
        {
          name: result.meta.name,
          platform: result.meta.platform,
          type: result.meta.type,
        },
        fixture.expected.meta
      )
      assert.deepEqual(result.members.map((member) => member.platformId).sort(), [...fixture.expected.memberIds].sort())
      assert.deepEqual(
        result.messages.map((message) => ({
          senderPlatformId: message.senderPlatformId,
          timestamp: message.timestamp,
          type: message.type,
          content: message.content,
        })),
        fixture.expected.messages
      )
    })
  }
})
