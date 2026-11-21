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
      '2024/01/02 03:04 - Alice: first line\r',
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

  it('preserves supported date orders, localized periods, and system messages containing colons', async () => {
    const content = [
      '02/01/2024 03:04 下午 - Alice: traditional period',
      '01/02/24 12:05 AM - Bob: english period',
      '[2024/01/02 오후 03:06] Alice: fallback marker order',
      '2024/01/02 03:07 - Alice changed this group: description',
    ].join('\n')

    const result = await parseWhatsAppText(content, 'WhatsApp locale fixture.txt')

    assert.deepEqual(
      result.messages.map((message) => ({
        sender: message.senderPlatformId,
        timestamp: message.timestamp,
        type: message.type,
      })),
      [
        { sender: 'Alice', timestamp: localTs('2024-01-02T15:04:00'), type: MessageType.TEXT },
        { sender: 'Bob', timestamp: localTs('2024-01-02T00:05:00'), type: MessageType.TEXT },
        { sender: 'Alice', timestamp: localTs('2024-01-02T15:06:00'), type: MessageType.TEXT },
        { sender: 'system', timestamp: localTs('2024-01-02T03:07:00'), type: MessageType.SYSTEM },
      ]
    )
  })

  it('switches the date order only when the preferred month cannot be a month', async () => {
    const content = [
      '12/25/2024, 10:30 AM - Alice: month-first date with a long year',
      '13/01/24, 10:30 - Bob: day above 12 with a short year',
      '25/12/24, 10:30 - Alice: day-first date with a short year',
      '02/01/2024, 10:30 - Alice: day-first date with a long year',
      '01/02/24, 10:30 - Bob: month-first date with a short year',
      '2024/01/02 10:30 - Alice: year-first date',
      '',
    ].join('\n')

    const result = await parseWhatsAppText(content, 'WhatsApp locale fixture.txt')

    assert.deepEqual(
      result.messages.map((message) => message.timestamp),
      [
        localTs('2024-12-25T10:30:00'),
        localTs('2024-01-13T10:30:00'),
        localTs('2024-12-25T10:30:00'),
        localTs('2024-01-02T10:30:00'),
        localTs('2024-01-02T10:30:00'),
        localTs('2024-01-02T10:30:00'),
      ]
    )
  })

  it('parses dot-separated day-first dates such as German exports', async () => {
    const android = ['05.03.24, 21:15 - Alice: short year', '06.03.2024, 08:01 - Bob: long year', ''].join('\n')
    const ios = ['[05.03.24, 21:15:32] Alice: short year', '[31.12.24, 23:59:59] Bob: day above 12', ''].join('\n')

    assert.equal(detectWhatsAppText(ios, '_chat.txt'), true)

    const androidResult = await parseWhatsAppText(android, 'WhatsApp Chat mit Alice.txt')
    const iosResult = await parseWhatsAppText(ios, '_chat.txt')

    assert.deepEqual(
      [...androidResult.messages, ...iosResult.messages].map((message) => [
        message.senderPlatformId,
        message.timestamp,
      ]),
      [
        ['Alice', localTs('2024-03-05T21:15:00')],
        ['Bob', localTs('2024-03-06T08:01:00')],
        ['Alice', localTs('2024-03-05T21:15:32')],
        ['Bob', localTs('2024-12-31T23:59:59')],
      ]
    )
  })

  it('applies file-level date order evidence consistently across short and long years', async () => {
    const dayFirstContent = [
      '13/01/24, 10:30 - Alice: day above 12 proves day-first',
      '05/03/24, 10:30 - Alice: ambiguous short year',
      '05/03/2024, 10:30 - Alice: ambiguous long year',
    ].join('\n')

    const dayFirstResult = await parseWhatsAppText(dayFirstContent, 'WhatsApp day-first.txt')
    assert.deepEqual(
      dayFirstResult.messages.map((message) => message.timestamp),
      [
        localTs('2024-01-13T10:30:00'),
        localTs('2024-03-05T10:30:00'),
        localTs('2024-03-05T10:30:00'),
      ]
    )

    const monthFirstContent = [
      '01/13/2024, 10:30 - Alice: second part above 12 proves month-first',
      '05/03/24, 10:30 - Alice: ambiguous short year',
      '05/03/2024, 10:30 - Alice: ambiguous long year',
    ].join('\n')

    const monthFirstResult = await parseWhatsAppText(monthFirstContent, 'WhatsApp month-first.txt')
    assert.deepEqual(
      monthFirstResult.messages.map((message) => message.timestamp),
      [
        localTs('2024-01-13T10:30:00'),
        localTs('2024-05-03T10:30:00'),
        localTs('2024-05-03T10:30:00'),
      ]
    )
  })

  it('infers date order from chronology when all dates are ambiguous', async () => {
    const content = [
      '03/02/2024, 10:00 - Alice: Feb 3 in day-first (Mar 2 in month-first)',
      '04/01/2024, 10:00 - Bob: Jan 4 in day-first (Apr 1 in month-first)',
    ].join('\n')

    const result = await parseWhatsAppText(content, 'WhatsApp chronology.txt')
    assert.deepEqual(
      result.messages.map((message) => message.timestamp),
      [localTs('2024-03-02T10:00:00'), localTs('2024-04-01T10:00:00')]
    )
  })

  it('skips calendar-invalid dates instead of rolling them into another date', async () => {
    const content = [
      '13/25/2024, 10:30 - Alice: invalid month and day',
      '32/12/2024, 10:30 - Alice: day 32',
      '2024/13/01 10:30 - Alice: month 13 in YMD',
      '[45/01/2024, 10:30:00] Alice: day 45 in iOS format',
      '2024/01/02 10:30 - Bob: valid message',
    ].join('\n')

    const result = await parseWhatsAppText(content, 'WhatsApp invalid-dates.txt')
    assert.equal(result.messages.length, 1)
    assert.equal(result.messages[0]?.senderPlatformId, 'Bob')
    assert.equal(result.messages[0]?.timestamp, localTs('2024-01-02T10:30:00'))
    assert.equal(result.skippedLines, 4)
  })
})
