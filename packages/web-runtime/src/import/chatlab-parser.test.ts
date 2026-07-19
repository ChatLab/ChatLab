import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { detectChatLabFormat, parseChatLabSource, type BrowserParseSource } from './chatlab-parser'

function source(name: string, content: string, type = 'application/json'): BrowserParseSource {
  const blob = new Blob([content], { type })
  return {
    name,
    size: blob.size,
    type: blob.type,
    text: () => blob.text(),
    arrayBuffer: () => blob.arrayBuffer(),
    slice: (start, end) => blob.slice(start, end),
  }
}

describe('ChatLab browser parser', () => {
  it('detects and parses ChatLab JSON while inferring unlisted senders', async () => {
    const file = source(
      'fixture.json',
      JSON.stringify({
        chatlab: { version: '1', exportedAt: 1 },
        meta: { name: 'Fixture', platform: 'wechat', type: 'group', ownerId: 'alice' },
        members: [{ platformId: 'alice', accountName: 'Alice' }],
        messages: [
          { sender: 'alice', accountName: 'Alice', timestamp: 1, type: 0, content: 'hello' },
          { sender: 'bob', accountName: 'Bob', timestamp: 2, type: 0, content: null },
        ],
      })
    )

    assert.equal(await detectChatLabFormat(file), 'chatlab')
    const parsed = await parseChatLabSource(file)

    assert.equal(parsed.formatId, 'chatlab')
    assert.deepEqual(parsed.meta, {
      name: 'Fixture',
      platform: 'wechat',
      type: 'group',
      ownerId: 'alice',
    })
    assert.deepEqual(
      parsed.members.map((member) => member.platformId),
      ['alice', 'bob']
    )
    assert.equal(parsed.messages.length, 2)
    assert.equal(parsed.messages[1].senderPlatformId, 'bob')
  })

  it('parses ChatLab JSONL strictly and reports the invalid line', async () => {
    const valid = source(
      'fixture.jsonl',
      [
        JSON.stringify({
          _type: 'header',
          chatlab: { version: '1', exportedAt: 1 },
          meta: { name: 'Fixture JSONL', platform: 'telegram', type: 'private' },
        }),
        JSON.stringify({ _type: 'member', platformId: 'alice', accountName: 'Alice' }),
        JSON.stringify({
          _type: 'message',
          sender: 'alice',
          accountName: 'Alice',
          timestamp: 3,
          type: 0,
          content: 'hello',
        }),
      ].join('\n'),
      'application/x-ndjson'
    )

    assert.equal(await detectChatLabFormat(valid), 'chatlab-jsonl')
    const parsed = await parseChatLabSource(valid)
    assert.equal(parsed.formatId, 'chatlab-jsonl')
    assert.equal(parsed.messages.length, 1)

    const invalid = source(
      'broken.jsonl',
      `${JSON.stringify({
        _type: 'header',
        chatlab: { version: '1', exportedAt: 1 },
        meta: { name: 'Broken', platform: 'unknown', type: 'group' },
      })}\nnot-json`
    )
    await assert.rejects(parseChatLabSource(invalid), /line 2/i)
  })

  it('rejects non-ChatLab input and observes cooperative cancellation', async () => {
    await assert.rejects(parseChatLabSource(source('other.json', '{"messages":[]}')), /Unsupported file format/)

    const file = source(
      'cancel.json',
      JSON.stringify({
        chatlab: { version: '1', exportedAt: 1 },
        meta: { name: 'Cancel', platform: 'unknown', type: 'group' },
        messages: Array.from({ length: 4 }, (_, index) => ({
          sender: `member-${index}`,
          accountName: `Member ${index}`,
          timestamp: index + 1,
          type: 0,
          content: 'message',
        })),
      })
    )
    let checks = 0
    await assert.rejects(
      parseChatLabSource(file, {
        checkCancelled: () => {
          checks += 1
          if (checks === 3) throw new Error('cancelled')
        },
        yieldEvery: 1,
      }),
      /cancelled/
    )
  })
})
