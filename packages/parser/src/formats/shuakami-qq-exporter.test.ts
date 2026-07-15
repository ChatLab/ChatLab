import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it } from 'node:test'
import { ChatType, MessageType } from '@openchatlab/shared-types'

import { detectFormat, parseFileSync } from '../index'
import type { ParseResult } from '../types'

function makeExport(options: {
  chatInfoType?: string
  senders: Array<{ uid: string; name: string }>
  messages: unknown[]
}): string {
  return JSON.stringify(
    {
      metadata: {
        name: 'QQChatExporter V6',
        version: '6.0.3',
        exportTime: '2026-07-12T01:20:23.000Z',
      },
      chatInfo: {
        name: 'Test Chat',
        ...(options.chatInfoType ? { type: options.chatInfoType } : {}),
      },
      statistics: {
        totalMessages: options.messages.length,
        senders: options.senders.map((s) => ({ ...s, messageCount: 1, percentage: 50 })),
      },
      messages: options.messages,
    },
    null,
    2
  )
}

function textMessage(uin: string, name: string, text: string, extra: Record<string, unknown> = {}): unknown {
  return {
    messageId: `msg-${uin}-${text}`,
    timestamp: '2026-07-10T12:00:00.000Z',
    sender: { uid: `u_${uin}`, uin, name },
    messageType: 2,
    content: { text },
    ...extra,
  }
}

function systemMessage(text: string): unknown {
  return {
    messageId: `sys-${text}`,
    timestamp: '2026-07-10T12:30:00.000Z',
    sender: { uid: '未知', uin: '0', name: '0' },
    messageType: 5,
    content: { text },
    system: true,
  }
}

async function parseContent(content: string): Promise<ParseResult> {
  const dir = mkdtempSync(join(tmpdir(), 'chatlab-qce-parser-'))
  try {
    const filePath = join(dir, 'qce-export.json')
    writeFileSync(filePath, content, 'utf-8')
    assert.equal(detectFormat(filePath)?.id, 'shuakami-qq-exporter')
    return await parseFileSync(filePath)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('shuakami-qq-exporter parser', () => {
  it('prefers chatInfo.type and skips placeholder system senders', async () => {
    const content = makeExport({
      chatInfoType: 'private',
      senders: [
        { uid: 'u_100', name: 'Alice' },
        { uid: 'u_200', name: 'Bob' },
        { uid: '未知', name: '0' },
      ],
      messages: [
        textMessage('100', 'Alice', 'hello'),
        textMessage('200', 'Bob', 'hi'),
        systemMessage('对方撤回了一条消息'),
      ],
    })

    const result = await parseContent(content)
    assert.equal(result.meta.type, ChatType.PRIVATE)
    assert.deepEqual(result.members.map((m) => m.platformId).sort(), ['100', '200'])
    assert.equal(result.messages.length, 2)
    assert.ok(result.messages.every((m) => m.senderPlatformId !== '0' && m.senderPlatformId !== '未知'))
  })

  it('falls back to real sender count when chatInfo.type is missing', async () => {
    const content = makeExport({
      senders: [
        { uid: 'u_100', name: 'Alice' },
        { uid: 'u_200', name: 'Bob' },
        { uid: '未知', name: '0' },
      ],
      messages: [textMessage('100', 'Alice', 'hello'), textMessage('200', 'Bob', 'hi')],
    })

    const result = await parseContent(content)
    assert.equal(result.meta.type, ChatType.PRIVATE)
  })

  it('overrides an incorrect private type when more than two real senders exist', async () => {
    const content = makeExport({
      chatInfoType: 'private',
      senders: [
        { uid: 'u_100', name: 'Alice' },
        { uid: 'u_200', name: 'Bob' },
        { uid: 'u_300', name: 'Carol' },
      ],
      messages: [
        textMessage('100', 'Alice', 'hello'),
        textMessage('200', 'Bob', 'hi'),
        textMessage('300', 'Carol', 'welcome'),
      ],
    })

    const result = await parseContent(content)
    assert.equal(result.meta.type, ChatType.GROUP)
  })

  it('supports current system/recalled field names alongside legacy ones', async () => {
    const content = makeExport({
      chatInfoType: 'group',
      senders: [
        { uid: 'u_100', name: 'Alice' },
        { uid: 'u_200', name: 'Bob' },
        { uid: 'u_300', name: 'Carol' },
      ],
      messages: [
        textMessage('100', 'Alice', 'recalled new', { recalled: true }),
        textMessage('200', 'Bob', 'recalled legacy', { isRecalled: true }),
        textMessage('300', 'Carol', 'notice', { system: true }),
      ],
    })

    const result = await parseContent(content)
    assert.equal(result.meta.type, ChatType.GROUP)
    assert.equal(result.messages.length, 3)
    assert.equal(result.messages[0].type, MessageType.RECALL)
    assert.equal(result.messages[0].content, '[已撤回] recalled new')
    assert.equal(result.messages[1].type, MessageType.RECALL)
    assert.equal(result.messages[2].type, MessageType.SYSTEM)
  })
})
