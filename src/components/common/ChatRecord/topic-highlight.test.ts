import assert from 'node:assert/strict'
import test from 'node:test'
import { isMessageInChatTopicHighlight, type ChatTopicHighlight } from './topic-highlight'

test('exact topic highlight excludes an interleaved message inside the same time range', () => {
  const highlight: ChatTopicHighlight = {
    messageIds: [1, 2, 4],
    timeRanges: [{ startTs: 100, endTs: 130 }],
    assignmentMode: 'exact',
    colorIndex: 0,
  }

  assert.equal(isMessageInChatTopicHighlight(highlight, { id: 2, timestamp: 110 }), true)
  assert.equal(isMessageInChatTopicHighlight(highlight, { id: 3, timestamp: 120 }), false)
})

test('legacy topic highlight keeps the minute-expanded range fallback', () => {
  const highlight: ChatTopicHighlight = {
    messageIds: [2],
    timeRanges: [{ startTs: 125, endTs: 125 }],
    assignmentMode: 'range',
    colorIndex: 0,
  }

  assert.equal(isMessageInChatTopicHighlight(highlight, { id: 1, timestamp: 120 }), true)
  assert.equal(isMessageInChatTopicHighlight(highlight, { id: 3, timestamp: 180 }), false)
})
