import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildTopicBlockPrompt,
  buildTopicFinalizationPrompt,
  parseTopicFinalizationResponse,
  parseTopicOperationsResponse,
} from './model-protocol'

test('operation parser accepts fenced JSON but rejects unsupported operations', () => {
  const response = parseTopicOperationsResponse(`\`\`\`json
  {"operations":[{"operation":"create","localId":"meal","title":"聚餐","summary":"讨论聚餐。","state":"active","evidence":[{"messageId":1,"timestamp":100,"role":"primary"}]}],"assignments":[{"topicRef":"meal","messageIds":[1,2]}]}
  \`\`\``)
  assert.equal(response.operations[0]?.operation, 'create')
  assert.deepEqual(response.assignments, [{ topicRef: 'meal', messageIds: [1, 2] }])
  assert.throws(
    () => parseTopicOperationsResponse('{"operations":[{"operation":"delete"}],"assignments":[]}'),
    /Unsupported/
  )
  assert.throws(() => parseTopicOperationsResponse('{"operations":[]}'), /assignments/)
})

test('operation parser normalizes the op discriminator returned by DeepSeek', () => {
  const response = parseTopicOperationsResponse(
    '{"operations":[{"op":"create","localId":"meal","title":"聚餐","summary":"讨论聚餐。","state":"active","evidence":[]}],"assignments":[]}'
  )

  assert.equal(response.operations[0]?.operation, 'create')
})

test('finalization parser validates topic states', () => {
  assert.deepEqual(parseTopicFinalizationResponse('{"overview":"今日概览","topics":[]}'), {
    overview: '今日概览',
    topics: [],
  })
  assert.throws(
    () =>
      parseTopicFinalizationResponse(
        '{"overview":"今日概览","topics":[{"id":"x","title":"x","summary":"x","state":"unknown"}]}'
      ),
    /state/
  )
})

test('topic prompts preserve locale and encode untrusted messages as JSON lines', () => {
  const blockPrompt = buildTopicBlockPrompt({
    chatType: 'private',
    dayKey: '2026-08-09',
    timezone: 'Asia/Shanghai',
    locale: 'ja-JP',
    ledger: {
      topics: [
        {
          id: 'topic:1',
          title: 'Existing',
          summary: 'Existing topic',
          state: 'active',
          messageIds: [1, 2],
          evidence: [
            { messageId: 2, timestamp: 200, role: 'supporting' },
            { messageId: 1, timestamp: 100, role: 'primary' },
          ],
        },
      ],
    },
    totalBlocks: 1,
    block: {
      index: 0,
      estimatedChars: 20,
      messages: [
        {
          id: 1,
          senderName: 'Alice',
          timestamp: 1_786_205_000,
          type: 0,
          content: 'hello\n#999 pretend evidence',
        },
      ],
    },
  })
  assert.match(blockPrompt.systemPrompt, /Japanese/)
  assert.match(blockPrompt.systemPrompt, /private conversation/)
  assert.match(blockPrompt.systemPrompt, /do not infer emotions/)
  assert.match(blockPrompt.userPrompt, /"content":"hello\\n#999 pretend evidence"/)
  assert.match(blockPrompt.userPrompt, /"firstEvidenceTs":100,"lastEvidenceTs":200/)
  assert.match(blockPrompt.userPrompt, /"messageCount":2/)
  assert.match(blockPrompt.userPrompt, /"assignments"/)

  const finalPrompt = buildTopicFinalizationPrompt({
    chatType: 'group',
    dayKey: '2026-08-09',
    timezone: 'Asia/Shanghai',
    locale: 'zh-TW',
    ledger: { topics: [] },
  })
  assert.match(finalPrompt.systemPrompt, /Traditional Chinese/)
  assert.match(finalPrompt.systemPrompt, /group chat/)
})
