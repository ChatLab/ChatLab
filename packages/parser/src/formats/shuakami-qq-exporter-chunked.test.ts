import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { ChatType, MessageType } from '@openchatlab/shared-types'

import { detectFormat, findEntryFileInDirectory, parseFileSync } from '../index'

describe('shuakami-qq-exporter chunked parser', () => {
  it('detects and parses manifests that store the JSONL format in chunked', async () => {
    const root = mkdtempSync(join(tmpdir(), 'chatlab-qce-chunked-'))
    const chunksDir = join(root, 'chunks')
    const manifestPath = join(root, 'manifest.json')

    try {
      mkdirSync(chunksDir)
      const manifest = JSON.stringify({
        metadata: { name: 'QQChatExporter', version: '0.1.0' },
        chatInfo: { name: 'Test Group', type: 'group', selfUin: '100' },
        statistics: {
          totalMessages: 2,
          senders: Array.from({ length: 1000 }, (_, index) => ({
            uid: `u_${index}`,
            name: `Member ${index} ${'x'.repeat(80)}`,
            messageCount: 1,
            percentage: 0.1,
          })),
        },
        chunked: {
          format: 'jsonl',
          chunksDir: 'chunks',
          chunkFileExt: '.jsonl',
          maxMessagesPerChunk: 50000,
          maxBytesPerChunk: 52428800,
          chunks: [{ relativePath: 'chunks/c000001.jsonl', count: 2 }],
        },
      })
      assert.ok(manifest.indexOf('"chunked"') > 64 * 1024)
      writeFileSync(manifestPath, manifest)
      writeFileSync(
        join(chunksDir, 'c000001.jsonl'),
        [
          {
            id: 'message-1',
            timestamp: 1752192000000,
            sender: { uid: 'u_100', uin: '100', name: 'Alice', nickname: 'Alice' },
            type: 'text',
            content: { text: 'hello' },
          },
          {
            id: 'message-2',
            timestamp: 1752192060000,
            sender: { uid: 'u_200', uin: '200', name: 'Bob', nickname: 'Bob' },
            type: 'text',
            content: { text: 'recalled' },
            recalled: true,
          },
        ]
          .map((message) => JSON.stringify(message))
          .join('\n')
      )

      assert.equal(detectFormat(manifestPath)?.id, 'shuakami-qq-exporter-chunked')
      assert.equal(findEntryFileInDirectory(root), manifestPath)

      const result = await parseFileSync(manifestPath)
      assert.equal(result.meta.type, ChatType.GROUP)
      assert.equal(result.messages.length, 2)
      assert.equal(result.messages[1].type, MessageType.RECALL)
      assert.equal(result.messages[1].content, '[已撤回] recalled')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
