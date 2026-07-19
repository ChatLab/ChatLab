import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ChatType, KNOWN_PLATFORMS, MessageType } from '@openchatlab/shared-types'

import { detectWhatsAppText, parseWhatsAppText } from './whatsapp'

function localTs(isoLocal: string): number {
  return Math.floor(new Date(isoLocal).getTime() / 1000)
}

describe('WhatsApp browser-safe text parser', () => {
  it('detects and parses official TXT exports without Node APIs', async () => {
    const content = [
      'Messages and calls are end-to-end encrypted.',
      '2024/01/02 03:04 - Alice: first line',
      'second line',
      '2024/01/02 03:05:06 PM - Bob: image omitted',
      '',
    ].join('\n')

    assert.equal(detectWhatsAppText(content, '与Alice的 WhatsApp 聊天.txt'), true)
    assert.equal(detectWhatsAppText('2024/01/02\tAlice\thello', '[LINE] Alice.txt'), false)

    const result = await parseWhatsAppText(content, '与Alice的 WhatsApp 聊天.txt')

    assert.deepEqual(result.meta, {
      name: 'Alice',
      platform: KNOWN_PLATFORMS.WHATSAPP,
      type: ChatType.PRIVATE,
    })
    assert.deepEqual(
      result.members.map((member) => member.platformId),
      ['Alice', 'Bob']
    )
    assert.deepEqual(result.messages, [
      {
        senderPlatformId: 'Alice',
        senderAccountName: 'Alice',
        timestamp: localTs('2024-01-02T03:04:00'),
        type: MessageType.TEXT,
        content: 'first line\nsecond line',
      },
      {
        senderPlatformId: 'Bob',
        senderAccountName: 'Bob',
        timestamp: localTs('2024-01-02T15:05:06'),
        type: MessageType.IMAGE,
        content: 'image omitted',
      },
    ])
  })

  it('infers the private chat name and checks cancellation while parsing', async () => {
    const content = [
      '[2026/7/9 23:39:03] Messages and calls are end-to-end encrypted.',
      '[2026/7/9 02:28:09] Alice: Hey',
      '[2026/7/9 02:28:37] Bob:Hi without sender-space',
      ...Array.from({ length: 1001 }, (_, index) => `[2026/7/10 02:28:37] Alice: message ${index}`),
      '',
    ].join('\n')
    let checks = 0

    const result = await parseWhatsAppText(content, '_chat.txt', {
      checkCancelled: () => {
        checks += 1
      },
      yieldEvery: 100,
    })

    assert.equal(result.meta.name, 'Alice')
    assert.equal(result.messages[0]?.senderPlatformId, 'system')
    assert.equal(result.messages[0]?.type, MessageType.SYSTEM)
    assert.equal(result.messages.length, 1004)
    assert.ok(checks > 10)
  })
})
