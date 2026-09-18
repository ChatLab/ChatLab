import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  assignSessionIndexes,
  buildTurns,
  compareMessageOrder,
  extractHanRuns,
  segmentWords,
  segmentWordsWithRegex,
  tokenizerIdentity,
  type TextUnitMessage,
} from './text-units'

const baseTs = 1_786_200_000

function message(id: number, senderId: number, offsetSeconds: number): TextUnitMessage {
  return { id, senderId, ts: baseTs + offsetSeconds }
}

describe('compareMessageOrder', () => {
  it('orders by timestamp and uses the id only inside the same second', () => {
    // An older export imported later gets larger ids than the newer messages already in the chat.
    const imported = [message(1, 1, 500), message(2, 2, 600), message(9, 1, 100), message(8, 2, 100)]

    assert.deepEqual(
      [...imported].sort(compareMessageOrder).map((item) => item.id),
      [8, 9, 1, 2]
    )
  })
})

describe('buildTurns', () => {
  const cases: Array<{ name: string; messages: TextUnitMessage[]; turns: number[][] }> = [
    {
      name: 'a sender change starts a new turn',
      messages: [message(1, 1, 0), message(2, 1, 10), message(3, 2, 20), message(4, 1, 30)],
      turns: [[1, 2], [3], [4]],
    },
    {
      name: 'a gap of exactly 300 seconds stays in the turn',
      messages: [message(1, 1, 0), message(2, 1, 300), message(3, 1, 600)],
      turns: [[1, 2, 3]],
    },
    {
      name: 'a gap of 301 seconds starts a new turn',
      messages: [message(1, 1, 0), message(2, 1, 301)],
      turns: [[1], [2]],
    },
  ]

  for (const { name, messages, turns } of cases) {
    it(name, () => {
      assert.deepEqual(
        buildTurns(messages).map((turn) => turn.messageIds),
        turns
      )
    })
  }

  it('records the sender and the first and last timestamp of each turn', () => {
    assert.deepEqual(buildTurns([message(1, 1, 0), message(2, 1, 120), message(3, 2, 130)]), [
      { index: 0, senderId: 1, startTs: baseTs, endTs: baseTs + 120, messageIds: [1, 2] },
      { index: 1, senderId: 2, startTs: baseTs + 130, endTs: baseTs + 130, messageIds: [3] },
    ])
  })
})

describe('assignSessionIndexes', () => {
  it('keeps a gap of exactly 1800 seconds in the session and splits at 1801', () => {
    const messages = [message(1, 1, 0), message(2, 2, 1800), message(3, 1, 3601), message(4, 2, 3602)]
    assert.deepEqual(assignSessionIndexes(messages), [0, 0, 1, 1])
    assert.deepEqual(assignSessionIndexes(messages, 60), [0, 1, 2, 2])
  })
})

describe('segmentWords', () => {
  // U+212B ANGSTROM SIGN normalizes to U+00C5; "e" + U+0301 composes to "é" and shortens the norm by one unit.
  const text = '周末见 See Ångström Café OK 123'

  function assertOffsets(tokens: ReturnType<typeof segmentWords>) {
    for (const token of tokens) assert.equal(text.slice(token.start, token.end), token.text)
  }

  it('keeps offsets into the original text and compares words in NFC with Latin lower case', () => {
    const tokens = segmentWords(text)
    assertOffsets(tokens)
    assert.equal(
      tokens
        .filter((token) => token.script === 'han')
        .map((token) => token.text)
        .join(''),
      '周末见'
    )
    assert.deepEqual(
      tokens
        .filter((token) => token.script !== 'han')
        .map(({ norm, start, end, script }) => ({ norm, start, end, script })),
      [
        { norm: 'see', start: 4, end: 7, script: 'latin' },
        { norm: 'ångström', start: 8, end: 16, script: 'latin' },
        { norm: 'café', start: 17, end: 22, script: 'latin' },
        { norm: 'ok', start: 23, end: 25, script: 'latin' },
        { norm: '123', start: 26, end: 29, script: 'other' },
      ]
    )
    assert.deepEqual(extractHanRuns(`OK${text}`), [{ text: '周末见', start: 2 }])
  })

  it('falls back to the regex rule when Intl.Segmenter is unavailable', () => {
    const fallback = segmentWordsWithRegex(text)
    assertOffsets(fallback)
    assert.deepEqual(
      fallback.map(({ norm, script }) => [norm, script]),
      [
        ['周末见', 'han'],
        ['see', 'latin'],
        ['ångström', 'latin'],
        // The combining mark is not \p{L}, so the fallback word stops before it.
        ['cafe', 'latin'],
        ['ok', 'latin'],
        ['123', 'other'],
      ]
    )
    assert.match(tokenizerIdentity(), /^intl-segmenter\/icu-/)

    const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter')
    assert.ok(descriptor)
    Reflect.deleteProperty(Intl, 'Segmenter')
    try {
      assert.deepEqual(segmentWords(text), fallback)
      assert.equal(tokenizerIdentity(), 'regex-fallback')
    } finally {
      Object.defineProperty(Intl, 'Segmenter', descriptor)
    }
    assert.match(tokenizerIdentity(), /^intl-segmenter\/icu-/)
  })
})
