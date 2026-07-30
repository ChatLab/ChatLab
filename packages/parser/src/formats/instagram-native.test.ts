import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { MessageType } from '@openchatlab/shared-types'

import { detectFormat, parseFileSync } from '../index'

function encodeInstagramText(value: string): string {
  return Buffer.from(value, 'utf8').toString('latin1')
}

describe('Instagram native parser', () => {
  it('decodes Instagram text and classifies system messages', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'chatlab-instagram-parser-'))
    try {
      const filePath = join(directory, 'message_1.json')
      writeFileSync(
        filePath,
        JSON.stringify({
          participants: [{ name: encodeInstagramText('小明') }, { name: encodeInstagramText('小红') }],
          messages: [
            {
              sender_name: encodeInstagramText('小红'),
              timestamp_ms: 2000,
              content: 'Alice added Bob to the group',
              is_geoblocked_for_viewer: false,
            },
            {
              sender_name: encodeInstagramText('小明'),
              timestamp_ms: 1000,
              content: encodeInstagramText('你好'),
              is_geoblocked_for_viewer: false,
            },
          ],
          title: encodeInstagramText('小红'),
          thread_path: 'inbox/example',
        }),
        'utf8'
      )

      assert.equal(detectFormat(filePath)?.id, 'instagram-native')
      const result = await parseFileSync(filePath)

      assert.equal(result.meta.name, '小红')
      assert.deepEqual(
        result.messages.map((message) => ({
          sender: message.senderAccountName,
          type: message.type,
          content: message.content,
        })),
        [
          { sender: '小明', type: MessageType.TEXT, content: '你好' },
          { sender: '小红', type: MessageType.SYSTEM, content: 'Alice added Bob to the group' },
        ]
      )
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
