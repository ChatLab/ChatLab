/**
 * Parity tests: the Rust ChatLab kernel must produce identical ParseResult
 * output to the pure-TS parser for spec-compliant files, and must fall back
 * to the TS parser for off-spec files.
 *
 * Skipped automatically when the native module has not been built locally
 * (pnpm build:native).
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it } from 'node:test'

import { detectFormat, parseFile, parseFileSync } from '../index'
import type { ParseResult } from '../types'
import { loadNativeParser } from './loader'

/** Collect a full ParseResult while capturing onLog messages. */
async function parseCollectingLogs(filePath: string, logs: string[]): Promise<ParseResult> {
  const result: ParseResult = {
    meta: { name: '', platform: '', type: 'group' as ParseResult['meta']['type'] },
    members: [],
    messages: [],
  }
  for await (const event of parseFile({ filePath, onLog: (_level, message) => logs.push(message) })) {
    if (event.type === 'meta') result.meta = event.data
    else if (event.type === 'members') result.members.push(...event.data)
    else if (event.type === 'messages') result.messages.push(...event.data)
    else if (event.type === 'error') throw event.data
  }
  return result
}

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

async function parseBothWays(filename: string, content: string, nativeLogs?: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'chatlab-json-parity-'))
  const filePath = join(dir, filename)
  try {
    writeFileSync(filePath, content, 'utf-8')
    assert.equal(detectFormat(filePath)?.id, 'chatlab')

    delete process.env[ENV_KEY]
    const nativeResult = nativeLogs ? await parseCollectingLogs(filePath, nativeLogs) : await parseFileSync(filePath)

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

// Canonical fixture used to verify native and TS parser parity.
const CANONICAL_FIXTURE = {
  chatlab: { version: '0.0.2', exportedAt: 1700000000, generator: 'ChatLab' },
  meta: {
    name: '测试群',
    platform: 'weixin',
    type: 'group',
    groupId: 'g1@chatroom',
    groupAvatar: 'https://example.com/g.jpg',
    ownerId: 'u1',
  },
  members: [
    {
      platformId: 'u1',
      accountName: 'Alice',
      groupNickname: '小A',
      aliases: ['Ally'],
      avatar: 'https://example.com/a.jpg',
    },
    { platformId: 'u2', accountName: 'Bob' },
  ],
  messages: [
    {
      platformMessageId: 'm1',
      sender: 'u1',
      accountName: 'Alice',
      groupNickname: '小A',
      timestamp: 1700000100,
      type: 0,
      content: '你好',
    },
    {
      platformMessageId: 'm2',
      sender: 'u2',
      accountName: 'Bob',
      timestamp: 1700000200,
      type: 25,
      content: '回复内容',
      replyToMessageId: 'm1',
    },
    // null content (e.g. image message) and no optional ids
    { sender: 'u1', accountName: 'Alice', groupNickname: '小A', timestamp: 1700000300, type: 1, content: null },
    // empty-string content passes through as-is
    { sender: 'u2', accountName: 'Bob', timestamp: 1700000400, type: 0, content: '' },
  ],
}

describe('chatlab native parser parity', { skip: !nativeAvailable() && 'native module not built' }, () => {
  it('produces identical output to the TS parser on a canonical file', async () => {
    const { nativeResult, tsResult } = await parseBothWays('测试群.json', JSON.stringify(CANONICAL_FIXTURE, null, 2))
    assertParity(nativeResult, tsResult)

    assert.equal(nativeResult.meta.name, '测试群')
    assert.equal(nativeResult.meta.platform, 'weixin')
    assert.equal(nativeResult.meta.groupId, 'g1@chatroom')
    assert.equal(nativeResult.meta.ownerId, 'u1')
    assert.equal(nativeResult.members.length, 2)
    assert.deepEqual(nativeResult.members[0].aliases, ['Ally'])
    assert.equal(nativeResult.members[0].avatar, 'https://example.com/a.jpg')
    assert.equal(nativeResult.messages.length, 4)
    assert.equal(nativeResult.messages[1].replyToMessageId, 'm1')
    assert.equal(nativeResult.messages[2].content, null)
    assert.equal(nativeResult.messages[3].content, '')
  })

  it('collects members from messages when the members array is absent', async () => {
    const noMembers = {
      chatlab: { version: '0.0.2' },
      meta: { name: '无成员表', platform: 'qq', type: 'group' },
      messages: [
        { sender: 'u1', accountName: '旧名', groupNickname: '昵称', timestamp: 1, type: 0, content: 'a' },
        // Later message replaces the whole member entry (JS Map.set semantics)
        { sender: 'u1', accountName: '新名', timestamp: 2, type: 0, content: 'b' },
        { sender: 'u2', accountName: 'B', timestamp: 3, type: 0, content: 'c' },
      ],
    }
    const { nativeResult, tsResult } = await parseBothWays('无成员表.json', JSON.stringify(noMembers))
    assertParity(nativeResult, tsResult)
    assert.equal(nativeResult.members.length, 2)
    assert.equal(nativeResult.members[0].accountName, '新名')
    assert.equal(nativeResult.members[0].groupNickname, undefined)
  })

  it('handles missing meta name and empty messages identically', async () => {
    const minimal = {
      chatlab: { version: '0.0.2' },
      meta: { platform: 'weixin', type: 'private' },
      messages: [],
    }
    const { nativeResult, tsResult } = await parseBothWays('私聊记录.json', JSON.stringify(minimal))
    assertParity(nativeResult, tsResult)
    // Default name falls back to the filename.
    assert.equal(nativeResult.meta.name, '私聊记录')
    assert.equal(nativeResult.meta.type, 'private')
    assert.deepEqual(nativeResult.messages, [])
  })

  it('keeps member roles and avatars in both parsers', async () => {
    const withRoles = {
      chatlab: { version: '0.0.2' },
      meta: { name: '带角色群', platform: 'qq', type: 'group' },
      members: [
        {
          platformId: 'u1',
          accountName: 'Alice',
          avatar: 'https://example.com/a.jpg',
          roles: [{ id: 'owner' }, { id: 'admin', name: '管理员' }],
        },
        { platformId: 'u2', accountName: 'Bob' },
      ],
      messages: [{ sender: 'u1', accountName: 'Alice', timestamp: 1, type: 0, content: 'x' }],
    }
    const { nativeResult, tsResult } = await parseBothWays('带角色群.json', JSON.stringify(withRoles))

    assertParity(nativeResult, tsResult)
    assert.equal(tsResult.members.length, 2)
    assert.equal(tsResult.members[0].avatar, 'https://example.com/a.jpg')
    assert.deepEqual(tsResult.members[0].roles, [{ id: 'owner' }, { id: 'admin', name: '管理员' }])
  })

  it('falls back to the TS parser for off-spec files', async () => {
    const offSpec = {
      chatlab: { version: '0.0.2' },
      meta: { name: '异常文件', platform: 'qq', type: 'group' },
      messages: [
        // content must be string|null per spec; a number forces the fallback.
        { sender: 'u1', accountName: 'A', timestamp: 1, type: 0, content: 42 },
      ],
    }
    const logs: string[] = []
    const { nativeResult, tsResult } = await parseBothWays('异常文件.json', JSON.stringify(offSpec), logs)
    assert.ok(
      logs.some((m) => m.includes('[NativeParser]') && m.includes('falling back')),
      'expected a fallback log entry'
    )
    // Fallback means the native path output IS the TS output, quirks included.
    assertParity(nativeResult, tsResult)
    assert.equal(nativeResult.messages[0].content, 42 as unknown as string)
  })
})
