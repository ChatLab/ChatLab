import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ChatType, KNOWN_PLATFORMS, MessageType } from '@openchatlab/shared-types'

import { detectLineText, parseLineText } from './line'

function localTs(isoLocal: string): number {
  return Math.floor(new Date(isoLocal).getTime() / 1000)
}

describe('LINE browser-safe text parser', () => {
  it('uses the official group header and parses multiline, media, and system messages', async () => {
    const content = [
      '[LINE] Chat history in Project Team',
      'Saved on: 2024/01/03 09:00',
      '',
      '2024.01.02 Tuesday',
      '03:04\tAlice\t"first line',
      'second line"',
      '03:05pm\tBob\t[Photo]',
      '03:06pm\t\tAlice joined the group',
      '',
    ].join('\n')

    assert.equal(detectLineText(content, '[LINE] Project Team.txt'), true)
    assert.equal(detectLineText('2024/01/02 03:04 - Alice: hello', '与Alice的 WhatsApp 聊天.txt'), false)

    const result = await parseLineText(content, '[LINE] Project Team.txt')

    assert.deepEqual(result.meta, {
      name: 'Project Team',
      platform: KNOWN_PLATFORMS.LINE,
      type: ChatType.GROUP,
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
        timestamp: localTs('2024-01-02T15:05:00'),
        type: MessageType.IMAGE,
        content: '[Photo]',
      },
      {
        senderPlatformId: 'system',
        senderAccountName: '系統',
        timestamp: localTs('2024-01-02T15:06:00'),
        type: MessageType.SYSTEM,
        content: 'Alice joined the group',
      },
    ])
  })

  it('supports localized timestamps and observes cooperative cancellation', async () => {
    const content = [
      '[LINE] 與Alice的聊天記錄',
      '儲存日期：2024/01/03 09:00',
      '',
      '2024/1/2週二',
      '下午03:04\tAlice\thello',
      ...Array.from({ length: 1001 }, (_, index) => `下午03:05\tAlice\tmessage ${index}`),
      '',
    ].join('\n')
    let checks = 0

    const result = await parseLineText(content, '[LINE] Alice.txt', {
      checkCancelled: () => {
        checks += 1
      },
      yieldEvery: 100,
    })

    assert.equal(result.meta.type, ChatType.PRIVATE)
    assert.equal(result.messages[0]?.timestamp, localTs('2024-01-02T15:04:00'))
    assert.equal(result.messages.length, 1002)
    assert.ok(checks > 10)
  })
})
