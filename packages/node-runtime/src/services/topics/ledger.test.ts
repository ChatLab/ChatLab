import assert from 'node:assert/strict'
import test from 'node:test'
import { applyTopicOperations, createEmptyTopicLedger, materializeChatTopics } from './ledger'
import type { TopicSourceMessage } from './source'

const messages: TopicSourceMessage[] = [
  { id: 1, senderName: 'Alice', timestamp: 100, type: 0, content: '周末去哪里吃饭？' },
  { id: 2, senderName: 'Bob', timestamp: 200, type: 0, content: '先去城西看看。' },
  { id: 3, senderName: 'Alice', timestamp: 8_000, type: 0, content: '继续说聚餐，周六可以吗？' },
]

test('runtime derives participants and discontinuous time ranges from cited messages', () => {
  let ledger = applyTopicOperations(
    createEmptyTopicLedger(),
    {
      operations: [
        {
          operation: 'create',
          localId: 'meal',
          title: '周末聚餐',
          summary: '讨论周末聚餐地点。',
          state: 'active',
          evidence: [
            { messageId: 1, timestamp: 999, role: 'primary' },
            { messageId: 2, timestamp: 200, role: 'supporting' },
          ],
        },
      ],
      assignments: [{ topicRef: 'meal', messageIds: [1, 2] }],
    },
    {
      sessionId: 'session',
      dayKey: '2026-08-09',
      localIdNamespace: 'block:0',
      currentMessages: messages.slice(0, 2),
    }
  )
  ledger = applyTopicOperations(
    ledger,
    {
      operations: [
        {
          operation: 'append',
          topicId: ledger.topics[0]!.id,
          summary: '讨论周末聚餐地点，并在数小时后继续确认日期。',
          evidence: [{ messageId: 3, timestamp: 8_000, role: 'primary' }],
        },
      ],
      assignments: [{ topicRef: ledger.topics[0]!.id, messageIds: [3] }],
    },
    {
      sessionId: 'session',
      dayKey: '2026-08-09',
      localIdNamespace: 'block:1',
      currentMessages: messages.slice(2),
    }
  )

  const topic = materializeChatTopics(ledger, messages)[0]!
  assert.deepEqual(topic.participants, ['Alice', 'Bob'])
  assert.deepEqual(topic.messageIds, [1, 2, 3])
  assert.equal(topic.assignmentMode, 'exact')
  assert.deepEqual(topic.timeRanges, [
    { startTs: 100, endTs: 200 },
    { startTs: 8_000, endTs: 8_000 },
  ])
})

test('model operations cannot cite messages outside the current block', () => {
  assert.throws(
    () =>
      applyTopicOperations(
        createEmptyTopicLedger(),
        {
          operations: [
            {
              operation: 'create',
              localId: 'invented',
              title: '虚构话题',
              summary: '引用了不存在的消息。',
              state: 'active',
              evidence: [{ messageId: 999, timestamp: 100, role: 'primary' }],
            },
          ],
          assignments: [{ topicRef: 'invented', messageIds: [999] }],
        },
        {
          sessionId: 'session',
          dayKey: '2026-08-09',
          localIdNamespace: 'block:0',
          currentMessages: messages,
        }
      ),
    /not in the current block/
  )
})

test('create local ids are isolated between source blocks', () => {
  const firstLedger = applyTopicOperations(
    createEmptyTopicLedger(),
    {
      operations: [
        {
          operation: 'create',
          localId: 'topic_1',
          title: '第一个话题',
          summary: '来自第一块。',
          state: 'closed',
          evidence: [{ messageId: 1, timestamp: 100, role: 'primary' }],
        },
      ],
      assignments: [{ topicRef: 'topic_1', messageIds: [1] }],
    },
    {
      sessionId: 'session',
      dayKey: '2026-08-09',
      localIdNamespace: 'block:0',
      currentMessages: messages.slice(0, 1),
    }
  )
  const secondLedger = applyTopicOperations(
    firstLedger,
    {
      operations: [
        {
          operation: 'create',
          localId: 'topic_1',
          title: '第二个话题',
          summary: '来自第二块。',
          state: 'active',
          evidence: [{ messageId: 3, timestamp: 8_000, role: 'primary' }],
        },
      ],
      assignments: [{ topicRef: 'topic_1', messageIds: [3] }],
    },
    {
      sessionId: 'session',
      dayKey: '2026-08-09',
      localIdNamespace: 'block:1',
      currentMessages: messages.slice(2),
    }
  )

  assert.equal(secondLedger.topics.length, 2)
  assert.notEqual(secondLedger.topics[0]!.id, secondLedger.topics[1]!.id)
})

test('exact message assignments preserve interleaved topic membership beyond representative evidence', () => {
  const interleavedMessages: TopicSourceMessage[] = [
    { id: 1, senderName: 'Alice', timestamp: 100, type: 0, content: '弟弟的分数有点尴尬。' },
    { id: 2, senderName: 'Bob', timestamp: 110, type: 0, content: '可以看看电气相关专业。' },
    { id: 3, senderName: 'Alice', timestamp: 120, type: 0, content: '顺便问下晚饭吃什么？' },
    { id: 4, senderName: 'Bob', timestamp: 130, type: 0, content: '他准备电气自动化了。' },
  ]
  const ledger = applyTopicOperations(
    createEmptyTopicLedger(),
    {
      operations: [
        {
          operation: 'create',
          localId: 'exam',
          title: '高考志愿',
          summary: '讨论弟弟的高考分数和电气自动化志愿。',
          state: 'closed',
          evidence: [
            { messageId: 1, timestamp: 100, role: 'primary' },
            { messageId: 4, timestamp: 130, role: 'supporting' },
          ],
        },
        {
          operation: 'create',
          localId: 'dinner',
          title: '晚饭安排',
          summary: '穿插询问晚饭。',
          state: 'closed',
          evidence: [{ messageId: 3, timestamp: 120, role: 'primary' }],
        },
      ],
      assignments: [
        { topicRef: 'exam', messageIds: [1, 2, 4] },
        { topicRef: 'dinner', messageIds: [3] },
      ],
    },
    {
      sessionId: 'session',
      dayKey: '2026-08-09',
      localIdNamespace: 'block:0',
      currentMessages: interleavedMessages,
    }
  )

  const topics = materializeChatTopics(ledger, interleavedMessages)
  assert.deepEqual(
    topics.map((topic) => topic.messageIds),
    [[1, 2, 4], [3]]
  )
})

test('one message cannot be assigned to multiple topics in the same block', () => {
  assert.throws(
    () =>
      applyTopicOperations(
        createEmptyTopicLedger(),
        {
          operations: [
            {
              operation: 'create',
              localId: 'first',
              title: '第一个话题',
              summary: '第一个话题。',
              state: 'active',
              evidence: [{ messageId: 1, timestamp: 100, role: 'primary' }],
            },
            {
              operation: 'create',
              localId: 'second',
              title: '第二个话题',
              summary: '第二个话题。',
              state: 'active',
              evidence: [{ messageId: 2, timestamp: 200, role: 'primary' }],
            },
          ],
          assignments: [
            { topicRef: 'first', messageIds: [1, 2] },
            { topicRef: 'second', messageIds: [2] },
          ],
        },
        {
          sessionId: 'session',
          dayKey: '2026-08-09',
          localIdNamespace: 'block:0',
          currentMessages: messages,
        }
      ),
    /multiple topics/
  )
})
