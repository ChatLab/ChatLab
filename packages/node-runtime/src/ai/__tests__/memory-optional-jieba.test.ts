import assert from 'node:assert/strict'
import test from 'node:test'
import type { AIMemoryEntry } from '@openchatlab/shared-types'

test('ranks Chinese memories without loading the optional Jieba segmenter', async (t) => {
  let segmentCalls = 0
  await t.mock.module('../../nlp/segmenter', {
    namedExports: {
      segment() {
        segmentCalls++
        throw new Error('optional Jieba dependency is unavailable')
      },
    },
  })
  const { rankMemoryEntries } = await import('../memory')
  const entries: AIMemoryEntry[] = [
    createMemoryEntry('unrelated', '回答保持简短', 200),
    createMemoryEntry('relevant', 'ChatLab CLI 的最近范围默认是 90 天', 100),
  ]

  const result = rankMemoryEntries(entries, {
    query: '查看 ChatLab CLI 最近联系人',
    locale: 'zh-CN',
  })

  assert.equal(result.retrievalMode, 'relevance')
  assert.equal(result.entries[0]?.id, 'relevant')
  assert.equal(segmentCalls, 0)
})

function createMemoryEntry(id: string, content: string, updatedAt: number): AIMemoryEntry {
  return {
    id,
    scopeType: 'global',
    scopeId: null,
    content,
    sourceType: 'user',
    sourceAIChatId: null,
    sourceMessageId: null,
    createdAt: updatedAt,
    updatedAt,
  }
}
