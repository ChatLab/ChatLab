import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { MessageType } from '@openchatlab/shared-types'

import { findEntryFileInDirectory, parseFileWithFormat } from '../index'

function makeTempDir(): string {
  const baseDir = process.env.CHATLAB_TEST_TMPDIR ?? (fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir())
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-jsonl-parser-'))
}

function writeChatLabJsonl(filePath: string, messageCount: number): void {
  const lines = [
    JSON.stringify({
      _type: 'header',
      chatlab: { version: '0.0.2', exportedAt: 1711468800 },
      meta: { name: 'JSONL Test', platform: 'wechat', type: 'group', groupId: 'group-1' },
    }),
    JSON.stringify({
      _type: 'member',
      platformId: 'member-1',
      accountName: 'Alice',
      avatar: 'data:image/png;base64,AAAA',
    }),
  ]

  for (let index = 0; index < messageCount; index++) {
    lines.push(
      JSON.stringify({
        _type: 'message',
        sender: 'member-1',
        accountName: 'Alice',
        timestamp: 1711468800 + index,
        type: MessageType.TEXT,
        content: `message-${index}`,
      })
    )
  }

  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf-8')
}

test('ChatLab JSONL emits message batches and progress while reading', async () => {
  const root = makeTempDir()
  const filePath = path.join(root, 'large-chat.jsonl')
  writeChatLabJsonl(filePath, 12)

  try {
    const batchSizes: number[] = []
    const dataEventTypes: string[] = []
    let progressCalls = 0
    let progressCallsAtFirstBatch: number | null = null

    for await (const event of parseFileWithFormat('chatlab-jsonl', {
      filePath,
      batchSize: 5,
      onProgress: () => {
        progressCalls++
      },
    })) {
      if (event.type === 'messages') {
        dataEventTypes.push(event.type)
        progressCallsAtFirstBatch ??= progressCalls
        batchSizes.push(event.data.length)
      } else if (event.type === 'members') {
        dataEventTypes.push(event.type)
        assert.equal(event.data[0]?.avatar, 'data:image/png;base64,AAAA')
      }
    }

    assert.deepEqual(batchSizes, [5, 5, 2])
    assert.deepEqual(dataEventTypes, ['members', 'messages', 'messages', 'messages'])
    assert.equal(progressCallsAtFirstBatch, 1)
    assert.equal(progressCalls, 4)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('directory entry detection accepts a top-level ChatLab JSONL file', () => {
  const root = makeTempDir()
  const filePath = path.join(root, 'chat.jsonl')
  fs.mkdirSync(path.join(root, 'media'))
  writeChatLabJsonl(filePath, 1)

  try {
    assert.equal(findEntryFileInDirectory(root), filePath)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
