/**
 * batchSegmentChineseWithStats 等价性测试
 *
 * 优化（C）：中文 meaningful/custom 模式下用单遍分词同时产出词频与词性统计。
 * 必须与旧实现 batchSegmentWithFrequency + collectPosTagStats 的组合结果完全一致，
 * 否则会改变词云与词性分布的展示行为。
 *
 * 运行：node --import tsx --test packages/node-runtime/src/nlp/segmenter.test.ts
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { batchSegmentChineseWithStats, batchSegmentWithFrequency, collectPosTagStats } from './segmenter'

const TEXTS = [
  '今天天气很好，我们一起去公园散步聊天',
  '公园里有很多人在散步，天气真的非常好',
  '我喜欢在周末去公园看书喝咖啡',
  '北京的秋天天气最舒服，适合出去走走',
  '聊天的时候要注意倾听对方说话',
  '咖啡和书是我周末的最爱',
]

function assertMapEqual(actual: Map<string, number>, expected: Map<string, number>, label: string): void {
  assert.equal(actual.size, expected.size, `${label}: size mismatch`)
  for (const [key, value] of expected) {
    assert.equal(actual.get(key), value, `${label}: value mismatch for "${key}"`)
  }
}

describe('batchSegmentChineseWithStats 与旧两遍分词等价', () => {
  it('meaningful 模式：词频/总数/去重数/词性统计均一致', () => {
    const opts = {
      minLength: 2,
      minCount: 1,
      topN: 100,
      posFilterMode: 'meaningful' as const,
      enableStopwords: true,
      dictType: 'default' as const,
    }
    const combined = batchSegmentChineseWithStats(TEXTS, 'zh-CN', opts)
    const freqOnly = batchSegmentWithFrequency(TEXTS, 'zh-CN', opts)
    const posOnly = collectPosTagStats(TEXTS, 2, true, 'default')

    assertMapEqual(combined.words, freqOnly.words, 'words')
    assert.equal(combined.uniqueWords, freqOnly.uniqueWords, 'uniqueWords')
    assert.equal(combined.totalWords, freqOnly.totalWords, 'totalWords')
    assertMapEqual(combined.posTagStats, posOnly, 'posTagStats')
  })

  it('custom 模式 + 排除词 + minCount：结果一致', () => {
    const opts = {
      minLength: 2,
      minCount: 2,
      topN: 50,
      posFilterMode: 'custom' as const,
      customPosTags: ['n', 'v', 'a'],
      enableStopwords: true,
      dictType: 'default' as const,
      excludeWords: ['公园'],
    }
    const combined = batchSegmentChineseWithStats(TEXTS, 'zh-CN', opts)
    const freqOnly = batchSegmentWithFrequency(TEXTS, 'zh-CN', opts)
    const posOnly = collectPosTagStats(TEXTS, 2, true, 'default')

    assertMapEqual(combined.words, freqOnly.words, 'words')
    assert.equal(combined.uniqueWords, freqOnly.uniqueWords, 'uniqueWords')
    assert.equal(combined.totalWords, freqOnly.totalWords, 'totalWords')
    // 词性统计不受 allowedTags / excludeWords 影响，覆盖全部有效词
    assertMapEqual(combined.posTagStats, posOnly, 'posTagStats')
    assert.ok(!combined.words.has('公园'), '排除词应被剔除')
  })

  it('topN 截断只影响展示数量，不影响 totalWords/uniqueWords', () => {
    const base = {
      minLength: 2,
      minCount: 1,
      posFilterMode: 'meaningful' as const,
      enableStopwords: true,
      dictType: 'default' as const,
    }
    const full = batchSegmentChineseWithStats(TEXTS, 'zh-CN', { ...base, topN: 100 })
    const limited = batchSegmentChineseWithStats(TEXTS, 'zh-CN', { ...base, topN: 3 })

    assert.ok(limited.words.size <= 3)
    assert.equal(limited.totalWords, full.totalWords)
    assert.equal(limited.uniqueWords, full.uniqueWords)
  })
})
