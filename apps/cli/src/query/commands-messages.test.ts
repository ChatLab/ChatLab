import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  assertContextAnchorsPresent,
  capExpandedSearchMessages,
  parseContextIds,
  parseSearchKeywords,
  searchTruncationStrategy,
} from './commands-messages'
import type { MessageLike } from './messages-output'

describe('capExpandedSearchMessages', () => {
  it('keeps hit messages when the cap is smaller than pre-context', () => {
    const messages: MessageLike[] = [
      { id: 10, senderName: 'Alice', content: 'before 1', timestamp: 1710000000 },
      { id: 11, senderName: 'Alice', content: 'before 2', timestamp: 1710000001 },
      { id: 12, senderName: 'Bob', content: 'alpha hit', timestamp: 1710000002 },
    ]

    const capped = capExpandedSearchMessages(messages, new Set([12]), 1)

    assert.deepEqual(
      capped.map((message) => message.id),
      [12]
    )
  })
})

describe('parseContextIds', () => {
  it('rejects blank id tokens instead of converting them to 0', () => {
    assert.throws(() => parseContextIds('1021,'), /Invalid --id value/)
    assert.throws(() => parseContextIds('1021,,1058'), /Invalid --id value/)
  })

  it('requires positive numeric message ids', () => {
    assert.deepEqual(parseContextIds('1021,1058'), [1021, 1058])
    assert.throws(() => parseContextIds('0'), /Invalid --id value/)
  })
})

describe('parseSearchKeywords', () => {
  it('trims keywords and rejects blank-only searches', () => {
    assert.deepEqual(parseSearchKeywords([' alpha ', 'beta']), ['alpha', 'beta'])
    assert.throws(() => parseSearchKeywords(['   ']), /Invalid search keywords/)
  })
})

describe('searchTruncationStrategy', () => {
  it('keeps newest chronological messages when search sort is descending', () => {
    assert.equal(searchTruncationStrategy('desc'), 'keep_last')
    assert.equal(searchTruncationStrategy('asc'), 'keep_first')
  })
})

describe('assertContextAnchorsPresent', () => {
  it('rejects context results that do not include every requested anchor id', () => {
    assert.throws(
      () =>
        assertContextAnchorsPresent(
          [999],
          [
            { id: 10, senderName: 'Alice', content: 'before', timestamp: 1710000000 },
            { id: 11, senderName: 'Bob', content: 'after', timestamp: 1710000001 },
          ],
          '999'
        ),
      /No messages found/
    )
  })
})
