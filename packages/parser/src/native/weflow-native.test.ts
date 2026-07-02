/**
 * Parity tests: the Rust WeFlow kernel must produce byte-for-byte identical
 * ParseResult output to the pure-TS stream-json parser.
 *
 * Skipped automatically when the native module has not been built locally
 * (pnpm build:native).
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it } from 'node:test'

import { detectFormat, parseFileSync } from '../index'
import type { ParseResult } from '../types'
import { loadNativeParser } from './loader'

const ENV_KEY = 'CHATLAB_DISABLE_NATIVE_PERF'

function nativeAvailable(): boolean {
  const saved = process.env[ENV_KEY]
  delete process.env[ENV_KEY]
  try {
    return loadNativeParser() !== null
  } finally {
    if (saved !== undefined) process.env[ENV_KEY] = saved
  }
}

async function parseBothWays(filename: string, content: string, expectedFormatId: string) {
  const dir = mkdtempSync(join(tmpdir(), 'chatlab-weflow-parity-'))
  const filePath = join(dir, filename)
  try {
    writeFileSync(filePath, content, 'utf-8')
    assert.equal(detectFormat(filePath)?.id, expectedFormatId)

    delete process.env[ENV_KEY]
    const nativeResult = await parseFileSync(filePath)

    process.env[ENV_KEY] = '1'
    const tsResult = await parseFileSync(filePath)

    return { nativeResult, tsResult }
  } finally {
    delete process.env[ENV_KEY]
    rmSync(dir, { recursive: true, force: true })
  }
}

function assertParity(nativeResult: ParseResult, tsResult: ParseResult) {
  assert.deepEqual(nativeResult.meta, tsResult.meta)
  assert.deepEqual(nativeResult.members, tsResult.members)
  assert.equal(nativeResult.messages.length, tsResult.messages.length)
  for (let i = 0; i < tsResult.messages.length; i++) {
    assert.deepEqual(nativeResult.messages[i], tsResult.messages[i], `message #${i} differs`)
  }
}

// Fixture covering every branch of processMessage / meta extraction:
// avatars lookup, @chatroom skip, missing/empty sender, missing/null
// createTime, non-string content, whitespace-only content, renamed member,
// senderAvatarKey fallback, unknown message type, ownerId inference.
const FULL_FIXTURE = {
  weflow: { version: '1.2.3', exportedAt: 1704164645 },
  session: {
    wxid: 'room123@chatroom',
    nickname: '昵称群',
    remark: '',
    displayName: '显示名群',
    type: '群聊',
    lastTimestamp: 1704200000,
    messageCount: 10,
    avatar: '',
  },
  avatars: {
    wxid_alice: 'data:image/jpeg;base64,ALICE',
    'room123@chatroom': 'data:image/jpeg;base64,ROOM',
    wxid_keyed: 'data:image/jpeg;base64,KEYED',
    wxid_empty: '',
  },
  messages: [
    {
      localId: 1,
      createTime: 1704164645,
      formattedTime: '',
      type: '文本消息',
      localType: 1,
      content: '  hello world  ',
      isSend: 0,
      senderUsername: 'wxid_alice',
      senderDisplayName: 'Alice',
      senderAvatarKey: 'wxid_alice',
      source: '',
    },
    // Owner message (isSend=1)
    {
      localId: 2,
      createTime: 1704164700,
      type: '图片消息',
      content: '[图片]',
      isSend: 1,
      senderUsername: 'wxid_owner',
      senderDisplayName: 'Me',
      senderAvatarKey: '',
      source: '',
    },
    // System message from the room itself -> skipped
    {
      localId: 3,
      createTime: 1704164710,
      type: '系统消息',
      content: 'joined',
      isSend: null,
      senderUsername: 'room123@chatroom',
      senderDisplayName: '群',
    },
    // Missing senderUsername -> skipped
    { localId: 4, createTime: 1704164720, type: '文本消息', content: 'no sender' },
    // Empty senderUsername -> skipped
    { localId: 5, createTime: 1704164725, type: '文本消息', content: 'x', senderUsername: '' },
    // Missing createTime -> skipped
    { localId: 6, type: '文本消息', content: 'no time', senderUsername: 'wxid_alice' },
    // Null createTime -> kept with null timestamp (importer will skip)
    {
      localId: 7,
      createTime: null,
      type: '文本消息',
      content: 'null time',
      senderUsername: 'wxid_alice',
      senderDisplayName: 'Alice',
    },
    // Non-string content -> JSON.stringify
    {
      localId: 8,
      createTime: 1704164730,
      type: '引用消息',
      content: { title: '引用', items: [1, true, null], nested: { a: 'b' } },
      isSend: 0,
      senderUsername: 'wxid_alice',
      senderDisplayName: 'Alice Renamed',
    },
    // Whitespace-only content -> null; avatar via senderAvatarKey pointing elsewhere
    {
      localId: 9,
      createTime: 1704164740,
      type: '未知类型(42)',
      content: '   ',
      isSend: 0,
      senderUsername: 'wxid_bob',
      senderDisplayName: '',
      senderAvatarKey: 'wxid_keyed',
    },
    // Numeric localId with fraction, emoji content, unicode whitespace trim
    {
      localId: 10.5,
      createTime: 1704164750,
      type: '动画表情',
      content: '\u00a0😀 表情 \u3000',
      isSend: 0,
      senderUsername: 'wxid_owner',
      senderDisplayName: 'Me2',
    },
    // Missing localId -> String(undefined); missing content -> null
    {
      createTime: 1704164760,
      type: '红包卡片',
      isSend: 0,
      senderUsername: 'wxid_alice',
      senderDisplayName: 'Alice Renamed',
    },
  ],
}

describe('weflow native parser parity', { skip: !nativeAvailable() && 'native module not built' }, () => {
  it('produces identical output to the TS parser on the full fixture', async () => {
    const { nativeResult, tsResult } = await parseBothWays(
      '显示名群.json',
      JSON.stringify(FULL_FIXTURE, null, 2),
      'weflow'
    )
    assertParity(nativeResult, tsResult)

    // Sanity-check key semantics directly (guards against both parsers
    // being wrong in the same way on the highest-risk branches).
    assert.equal(nativeResult.meta.name, '显示名群')
    assert.equal(nativeResult.meta.groupId, 'room123@chatroom')
    assert.equal(nativeResult.meta.groupAvatar, 'data:image/jpeg;base64,ROOM')
    assert.equal(nativeResult.meta.ownerId, 'wxid_owner')
    assert.equal(nativeResult.messages.length, 7)
    assert.equal(nativeResult.messages[0].content, 'hello world')
    assert.equal(nativeResult.messages[2].timestamp, null)
    assert.equal(nativeResult.messages[3].content, '{"title":"引用","items":[1,true,null],"nested":{"a":"b"}}')
    assert.equal(nativeResult.messages[4].content, null)
    assert.equal(nativeResult.messages[5].platformMessageId, '10.5')
    assert.equal(nativeResult.messages[6].platformMessageId, 'undefined')
    const bob = nativeResult.members.find((m) => m.platformId === 'wxid_bob')
    assert.equal(bob?.avatar, 'data:image/jpeg;base64,KEYED')
    assert.equal(bob?.accountName, 'wxid_bob')
    const alice = nativeResult.members.find((m) => m.platformId === 'wxid_alice')
    assert.equal(alice?.accountName, 'Alice Renamed')
  })

  it('handles private chats and missing session identically', async () => {
    const privateChat = {
      weflow: { version: '1.0.0' },
      session: { wxid: 'wxid_friend', type: '私聊', nickname: '好友', displayName: '' },
      avatars: {},
      messages: [
        {
          localId: 1,
          createTime: 100,
          type: '文本消息',
          content: 'hi',
          isSend: 1,
          senderUsername: 'wxid_me',
          senderDisplayName: '我',
        },
      ],
    }
    const { nativeResult, tsResult } = await parseBothWays('好友聊天.json', JSON.stringify(privateChat), 'weflow')
    assertParity(nativeResult, tsResult)
    assert.equal(nativeResult.meta.type, 'private')
    assert.equal(nativeResult.meta.groupId, undefined)
    assert.equal(nativeResult.meta.name, '好友')
  })

  it('handles the echotrace variant (shared parser) identically', async () => {
    const echotrace = {
      session: { wxid: 'room9@chatroom', type: '群聊', displayName: 'Echo 群' },
      messages: [
        {
          localId: 1,
          createTime: 200,
          type: '文本消息',
          content: 'echo',
          isSend: 0,
          senderUsername: 'wxid_e',
          senderDisplayName: 'E',
        },
      ],
    }
    const { nativeResult, tsResult } = await parseBothWays(
      'echo.json',
      JSON.stringify(echotrace),
      'ycccccccy-echotrace'
    )
    assertParity(nativeResult, tsResult)
    assert.equal(nativeResult.messages.length, 1)
  })

  it('handles empty message arrays identically', async () => {
    const empty = {
      weflow: { version: '1.0.0' },
      session: { wxid: 'r@chatroom', type: '群聊', displayName: '空群' },
      avatars: {},
      messages: [],
    }
    const { nativeResult, tsResult } = await parseBothWays('空群.json', JSON.stringify(empty), 'weflow')
    assert.deepEqual(nativeResult.meta, tsResult.meta)
    assert.deepEqual(nativeResult.members, tsResult.members)
    assert.deepEqual(nativeResult.messages, tsResult.messages)
  })
})
