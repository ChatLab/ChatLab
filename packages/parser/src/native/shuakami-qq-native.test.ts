/** Native/TypeScript parity and strict fallback tests for shuakami/qq-chat-exporter V4 exports. */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { MessageType } from '@openchatlab/shared-types'

import { parseShuakamiQqV4, parseShuakamiQqV4Accelerated } from '../formats/shuakami-qq-exporter'
import type { ParseEvent, ParsedMember, ParsedMessage, ParsedMeta } from '../types'
import { isNativeFormatAvailable } from './loader'

const ENV_KEY = 'CHATLAB_DISABLE_NATIVE_PERF'

interface CollectedParse {
  meta?: ParsedMeta
  members: ParsedMember[]
  messages: ParsedMessage[]
  done?: { messageCount: number; memberCount: number }
  progress: ParseEvent[]
  logs: Array<{ level: string; message: string }>
}

async function collect(parser: typeof parseShuakamiQqV4, filePath: string, batchSize = 4): Promise<CollectedParse> {
  const result: CollectedParse = { members: [], messages: [], progress: [], logs: [] }
  for await (const event of parser({
    filePath,
    batchSize,
    onLog(level, message) {
      result.logs.push({ level, message })
    },
  })) {
    switch (event.type) {
      case 'meta':
        result.meta = event.data
        break
      case 'members':
        result.members.push(...event.data)
        break
      case 'messages':
        result.messages.push(...event.data)
        break
      case 'done':
        result.done = event.data
        break
      case 'progress':
        result.progress.push(event)
        break
    }
  }
  return result
}

function makeFullFixture(): string {
  const message = (
    id: string,
    sender: Record<string, unknown>,
    content: Record<string, unknown>,
    extra: Record<string, unknown> = {}
  ) => ({
    messageId: id,
    timestamp: '2026-07-10T12:00:00.123Z',
    sender,
    messageType: 2,
    content: { ...content, html: '<div>ignored</div>', raw: { ignored: true } },
    ...extra,
  })

  return JSON.stringify({
    metadata: { name: 'QQChatExporter V6', version: '6.0.3' },
    chatInfo: { name: 'Native QQ 测试群', type: 'group', avatar: 'data:image/png;base64,GROUP' },
    statistics: {
      senders: [
        { uid: 'u_100', name: 'Alice' },
        { uid: 'u_200', name: 'Bob' },
        { uid: 'u_300', name: 'Carol' },
      ],
    },
    messages: [
      message(
        'image',
        { uin: '100', uid: 'u_100', name: 'Alice sender' },
        {
          text: '[红包]',
          resources: [{ type: 'image' }, { type: 'video' }],
          emojis: [{ type: 'face' }],
          reply: { referencedMessageId: 'before-image' },
        },
        { rawMessage: { sendNickName: 'Alice QQ', sendMemberName: 'Alice Card' } }
      ),
      message('video', { uin: '', uid: 'u_200', name: 'Bob' }, { text: '', resources: [{ type: 'video' }] }),
      message(
        'voice',
        { uin: '', uid: '', name: 'Carol' },
        { text: 'voice', resources: [{ type: 'voice' }] },
        { rawMessage: { senderUin: '300', sendNickName: 'Carol QQ' } }
      ),
      message(
        'audio',
        { uin: '', uid: '', name: 'Dave' },
        { text: 'audio', resources: [{ type: 'audio' }] },
        { rawMessage: { senderUid: 'uid_400', sendNickName: 'Dave QQ' } }
      ),
      message('file', { uin: '100', name: 'Alice' }, { text: 'file', resources: [{ type: 'file' }] }),
      message(
        'location-resource',
        { uin: '100', name: 'Alice' },
        {
          text: 'location',
          resources: [{ type: 'location' }],
        }
      ),
      message('emoji', { uin: '100', name: 'Alice' }, { text: 'emoji', emojis: [{ type: 'face' }] }),
      message('red-packet', { uin: '100', name: 'Alice' }, { text: '发出了红包，请查收' }),
      message('transfer', { uin: '100', name: 'Alice' }, { text: '收到一笔转账' }),
      message('poke', { uin: '100', name: 'Alice' }, { text: 'Bob 拍了拍 Alice' }),
      message('call', { uin: '100', name: 'Alice' }, { text: '语音通话 通话时长 01:00' }),
      message('share', { uin: '100', name: 'Alice' }, { text: '[小程序]' }),
      message('link', { uin: '100', name: 'Alice' }, { text: '[卡片消息]' }),
      message('location-text', { uin: '100', name: 'Alice' }, { text: '[地理位置]' }),
      message('forward', { uin: '100', name: 'Alice' }, { text: '[聊天记录]' }),
      message('numeric-image', { uin: '100', name: 'Alice' }, { text: 'numeric image' }, { messageType: 3 }),
      message('numeric-video', { uin: '100', name: 'Alice' }, { text: 'numeric video' }, { messageType: 7 }),
      message('numeric-reply', { uin: '100', name: 'Alice' }, { text: 'numeric reply' }, { messageType: 9 }),
      message('recalled', { uin: '100', name: 'Alice' }, { text: '' }, { recalled: true }),
      message('system-recalled', { uin: '100', name: 'Alice' }, { text: 'notice' }, { system: true, recalled: true }),
      message(
        'current-false',
        { uin: '100', name: 'Alice' },
        { text: 'ordinary' },
        { system: false, isSystemMessage: true, recalled: false, isRecalled: true }
      ),
      message(
        'number-time',
        { uin: '100', name: 'Alice' },
        { text: 'number timestamp' },
        { timestamp: 1_752_148_800_999 }
      ),
      message(
        'offset-time',
        { uin: '100', name: 'Alice' },
        { text: 'offset timestamp' },
        { timestamp: '2026-07-10T20:00:00.999+08:00' }
      ),
      message('whitespace', { uin: '100', name: 'Alice' }, { text: '   ' }),
      message(
        'invalid-time-renames-member',
        { uin: '100', name: 'Alice' },
        { text: 'skipped' },
        {
          timestamp: '1998-07-10T12:00:00.000Z',
          rawMessage: { sendNickName: 'Alice Latest', sendMemberName: '' },
        }
      ),
      message('placeholder', { uin: '0', uid: '未知', name: 'System' }, { text: 'skipped' }),
    ],
    avatars: {
      '100': 'data:image/jpeg;base64,ALICE',
      u_200: 'https://example.com/not-data-image.png',
      '300': 'data:image/png;base64,CAROL',
    },
  })
}

function assertCoreParity(nativeResult: CollectedParse, tsResult: CollectedParse): void {
  assert.deepEqual(nativeResult.meta, tsResult.meta)
  assert.deepEqual(nativeResult.members, tsResult.members)
  assert.deepEqual(nativeResult.messages, tsResult.messages)
  assert.deepEqual(nativeResult.done, tsResult.done)
  assert.deepEqual(
    nativeResult.progress.map((event) => event.data),
    tsResult.progress.map((event) => event.data)
  )
}

const nativeAvailable = (() => {
  const saved = process.env[ENV_KEY]
  delete process.env[ENV_KEY]
  try {
    return isNativeFormatAvailable('shuakami-qq-exporter')
  } finally {
    if (saved !== undefined) process.env[ENV_KEY] = saved
  }
})()

describe('shuakami/qq-chat-exporter native parser', { skip: !nativeAvailable && 'native module not built' }, () => {
  it('matches the pure TS parser across meta, member, content, type, reply and timestamp semantics', async () => {
    assert.equal(isNativeFormatAvailable('not-a-real-format'), false)
    const directory = mkdtempSync(join(tmpdir(), 'chatlab-shuakami-qq-native-parity-'))
    const filePath = join(directory, 'shuakami-qq-v4.json')
    try {
      writeFileSync(filePath, makeFullFixture(), 'utf-8')
      const tsResult = await collect(parseShuakamiQqV4, filePath)
      const nativeResult = await collect(parseShuakamiQqV4Accelerated, filePath)
      assertCoreParity(nativeResult, tsResult)

      assert.equal(nativeResult.meta?.groupAvatar, 'data:image/png;base64,GROUP')
      assert.equal(nativeResult.messages.length, 24)
      assert.deepEqual(
        nativeResult.messages.slice(0, 7).map((message) => message.type),
        [
          MessageType.IMAGE,
          MessageType.VIDEO,
          MessageType.VOICE,
          MessageType.VOICE,
          MessageType.FILE,
          MessageType.LOCATION,
          MessageType.EMOJI,
        ]
      )
      assert.equal(nativeResult.messages[0].replyToMessageId, 'before-image')
      assert.equal(nativeResult.messages[18].content, '[已撤回] ')
      assert.equal(nativeResult.messages[19].type, MessageType.SYSTEM)
      assert.equal(nativeResult.messages[19].content, '[已撤回] notice')
      assert.equal(nativeResult.messages[20].type, MessageType.TEXT)
      assert.equal(nativeResult.messages[23].content, '   ')
      const alice = nativeResult.members.find((member) => member.platformId === '100')
      assert.equal(alice?.accountName, 'Alice Latest')
      assert.equal(alice?.groupNickname, 'Alice Card')
      assert.equal(alice?.avatar, 'data:image/jpeg;base64,ALICE')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('falls back to V8 Date.parse for supported non-RFC3339 timestamp spellings before emitting data', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'chatlab-shuakami-qq-native-fallback-'))
    const filePath = join(directory, 'shuakami-qq-v4.json')
    try {
      const fixture = JSON.parse(makeFullFixture()) as { messages: Array<Record<string, unknown>> }
      fixture.messages = [fixture.messages[0]]
      fixture.messages[0].timestamp = 'July 10, 2026 12:00:00 GMT'
      writeFileSync(filePath, JSON.stringify(fixture), 'utf-8')

      const tsResult = await collect(parseShuakamiQqV4, filePath)
      const acceleratedResult = await collect(parseShuakamiQqV4Accelerated, filePath)
      assert.deepEqual(acceleratedResult.meta, tsResult.meta)
      assert.deepEqual(acceleratedResult.members, tsResult.members)
      assert.deepEqual(acceleratedResult.messages, tsResult.messages)
      assert.match(
        acceleratedResult.logs.find((entry) => entry.message.includes('falling back to TS parser'))?.message ?? '',
        /unsupported timestamp string/
      )
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('honors CHATLAB_DISABLE_NATIVE_PERF', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'chatlab-shuakami-qq-native-disabled-'))
    const filePath = join(directory, 'shuakami-qq-v4.json')
    const saved = process.env[ENV_KEY]
    try {
      writeFileSync(filePath, makeFullFixture(), 'utf-8')
      process.env[ENV_KEY] = '1'
      assert.equal(isNativeFormatAvailable('shuakami-qq-exporter'), false)
      const result = await collect(parseShuakamiQqV4Accelerated, filePath)
      assert.equal(result.messages.length, 24)
      assert.equal(
        result.logs.some((entry) => entry.message.includes('[NativeParser]')),
        false
      )
    } finally {
      if (saved === undefined) delete process.env[ENV_KEY]
      else process.env[ENV_KEY] = saved
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
