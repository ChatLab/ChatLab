import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildSemanticSearchGuidance } from './semantic-search-guidance'

describe('buildSemanticSearchGuidance', () => {
  it('routes enumeration / topic-discovery questions to semantic search (zh)', () => {
    const text = buildSemanticSearchGuidance('zh-CN')
    assert.ok(text.includes('semantic_search_current_chat'))
    // 枚举/盘点类问题应明确指向向量检索
    assert.ok(text.includes('哪些') || text.includes('盘点'))
    // 显式劝阻多轮关键词穷举（本次回归的核心）
    assert.ok(text.includes('穷举'))
    assert.ok(text.includes('retrieve_chat_evidence'))
    assert.ok(text.includes('search_messages'))
  })

  it('routes enumeration / topic-discovery questions to semantic search (en)', () => {
    const text = buildSemanticSearchGuidance('en-US')
    assert.ok(text.includes('semantic_search_current_chat'))
    assert.ok(/enumerate|inventory|which ones/i.test(text))
    assert.ok(/brute-force/i.test(text))
    assert.ok(text.includes('retrieve_chat_evidence'))
    assert.ok(text.includes('search_messages'))
  })
})
