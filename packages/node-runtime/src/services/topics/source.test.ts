import assert from 'node:assert/strict'
import test from 'node:test'
import {
  TOPIC_BLOCK_MAX_CHARS,
  TOPIC_BLOCK_MAX_MESSAGES,
  chunkTopicMessages,
  createTopicSourceSignature,
  type TopicSourceMessage,
} from './source'

function message(id: number, content = 'hello'): TopicSourceMessage {
  return { id, senderName: 'Alice', timestamp: 1_786_205_000 + id, type: 0, content }
}

test('topic source signatures change when message evidence changes', () => {
  const initial = [message(1), message(2)]
  assert.equal(createTopicSourceSignature(initial, 'group'), createTopicSourceSignature(initial, 'group'))
  assert.notEqual(
    createTopicSourceSignature(initial, 'group'),
    createTopicSourceSignature([message(1), message(2, 'changed')], 'group')
  )
  assert.notEqual(
    createTopicSourceSignature(initial, 'group'),
    createTopicSourceSignature([...initial, message(3)], 'group')
  )
  assert.notEqual(createTopicSourceSignature(initial, 'group'), createTopicSourceSignature(initial, 'private'))
})

test('topic chunks are deterministic and never exceed the message budget', () => {
  const messages = Array.from({ length: TOPIC_BLOCK_MAX_MESSAGES + 1 }, (_, index) => message(index + 1))
  const first = chunkTopicMessages(messages)
  const second = chunkTopicMessages(messages)
  assert.equal(first.length, 2)
  assert.equal(first[0]?.messages.length, TOPIC_BLOCK_MAX_MESSAGES)
  assert.equal(first[1]?.messages.length, 1)
  assert.deepEqual(first, second)
})

test('topic chunks keep ordinary source blocks within the character budget', () => {
  const messages = Array.from({ length: 120 }, (_, index) => message(index + 1, 'x'.repeat(80)))
  const blocks = chunkTopicMessages(messages)

  assert.ok(blocks.length > 1)
  assert.ok(blocks.every((block) => block.estimatedChars <= TOPIC_BLOCK_MAX_CHARS))
})

test('an oversized single message is bounded in source blocks without mutating the original message', () => {
  const oversized = message(1, 'x'.repeat(20_000))
  const blocks = chunkTopicMessages([oversized, message(2)])

  assert.equal(blocks.length, 2)
  assert.ok((blocks[0]?.messages[0]?.content.length ?? 0) < oversized.content.length)
  assert.match(blocks[0]?.messages[0]?.content ?? '', /truncated for topic analysis/)
  assert.ok(blocks.every((block) => block.estimatedChars <= TOPIC_BLOCK_MAX_CHARS))
  assert.equal(oversized.content.length, 20_000)
  assert.equal(blocks[0]?.messages[0]?.id, oversized.id)
})
