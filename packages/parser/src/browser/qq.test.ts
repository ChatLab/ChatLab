import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ChatType, KNOWN_PLATFORMS, MessageType } from '@openchatlab/shared-types'

import { detectQqText, parseQqText } from './qq'

function localTs(isoLocal: string): number {
  return Math.floor(new Date(isoLocal).getTime() / 1000)
}

describe('QQ browser-safe text parser', () => {
  it('parses official group exports, multiline content, identifiers, and nickname history', async () => {
    const content = [
      '消息记录（此消息记录为文本格式，不支持重新导入）',
      '消息分组:我的群',
      '消息对象:Project Team',
      '2024-01-02 03:04:05 【管理员】Alice(10001)',
      'first line',
      'second line',
      '2024-01-02 03:05:06 10001(10001)',
      '[图片]',
      '2024-01-02 03:06:07 Bob<example@example.com>',
      '[红包]',
      '2024-01-02 03:07:08 Carol',
      'discussion message',
      '',
    ].join('\n')

    assert.equal(detectQqText(content, 'qq-group.txt'), true)
    assert.equal(detectQqText('2024/01/02 03:04 - Alice: hello', '与Alice的 WhatsApp 聊天.txt'), false)

    const result = await parseQqText(content, 'qq-group.txt')

    assert.deepEqual(result.meta, {
      name: 'Project Team',
      platform: KNOWN_PLATFORMS.QQ,
      type: ChatType.GROUP,
    })
    assert.deepEqual(result.members, [
      { platformId: '10001', accountName: 'Alice' },
      { platformId: 'example@example.com', accountName: 'Bob' },
      { platformId: 'Carol', accountName: 'Carol' },
    ])
    assert.deepEqual(result.messages, [
      {
        senderPlatformId: '10001',
        senderAccountName: 'Alice',
        timestamp: localTs('2024-01-02T03:04:05'),
        type: MessageType.TEXT,
        content: 'first line\nsecond line',
      },
      {
        senderPlatformId: '10001',
        senderAccountName: 'Alice',
        timestamp: localTs('2024-01-02T03:05:06'),
        type: MessageType.IMAGE,
        content: '[图片]',
      },
      {
        senderPlatformId: 'example@example.com',
        senderAccountName: 'Bob',
        timestamp: localTs('2024-01-02T03:06:07'),
        type: MessageType.RED_PACKET,
        content: '[红包]',
      },
      {
        senderPlatformId: 'Carol',
        senderAccountName: 'Carol',
        timestamp: localTs('2024-01-02T03:07:08'),
        type: MessageType.TEXT,
        content: 'discussion message',
      },
    ])
    assert.equal(result.skippedLines, 0)
  })

  it('isolates nickname history between files and observes cooperative cancellation', async () => {
    const first = ['消息对象:First', '2024-01-02 03:04:05 Alice(10001)', 'hello'].join('\n')
    const second = [
      '消息对象:Second',
      '2024-01-02 03:04:05 10001(10001)',
      'hello',
      ...Array.from(
        { length: 1001 },
        (_, index) =>
          `2024-01-02 03:${String(index % 60).padStart(2, '0')}:06 Member ${index}(${index + 20_000})\nmessage ${index}`
      ),
    ].join('\n')
    let checks = 0

    await parseQqText(first, 'first.txt')
    const result = await parseQqText(second, 'second.txt', {
      checkCancelled: () => {
        checks += 1
      },
      yieldEvery: 100,
    })

    assert.equal(result.messages[0]?.senderAccountName, '10001')
    assert.equal(result.messages.length, 1002)
    assert.ok(checks > 20)
  })
})
