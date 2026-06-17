import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assembleEvidence,
  formatEvidenceMessages,
  type EvidenceHit,
  type EvidenceMessage,
  type MessageRangeReader,
} from './evidence'
import { estimateTokens } from '../tokens'

function makeMessages(startId: number, endId: number, charsPerMsg = 10): EvidenceMessage[] {
  const filler = '一二三四五六七八九十'.slice(0, charsPerMsg)
  const msgs: EvidenceMessage[] = []
  for (let id = startId; id <= endId; id++) {
    msgs.push({ id, senderName: '甲', content: filler, ts: id * 1000 })
  }
  return msgs
}

/** 多 parent 内存 reader：按 id 升序返回区间消息 */
function makeReader(all: EvidenceMessage[]): MessageRangeReader {
  return {
    readRange(startId, endId) {
      return all.filter((m) => m.id >= startId && m.id <= endId)
    },
  }
}

function parentId(start: number, end: number): string {
  return `parent:${start}:${end}:1800:v1.0:cfg`
}

function hit(chunkId: string, p: [number, number], range: [number, number], score: number): EvidenceHit {
  return { chunkId, score, parentId: parentId(p[0], p[1]), startMessageId: range[0], endMessageId: range[1] }
}

test('expands hit by ±N messages within parent', () => {
  const reader = makeReader(makeMessages(1, 20))
  const result = assembleEvidence(reader, [hit('c1', [1, 20], [10, 11], 1)], { expandMessages: 3 })

  assert.equal(result.blocks.length, 1)
  const block = result.blocks[0]
  assert.equal(block.startMessageId, 7)
  assert.equal(block.endMessageId, 14)
  assert.deepEqual(block.chunkIds, ['c1'])
})

test('clamps expansion at parent start boundary', () => {
  const reader = makeReader(makeMessages(1, 20))
  const result = assembleEvidence(reader, [hit('c1', [1, 20], [2, 3], 1)], { expandMessages: 3 })

  assert.equal(result.blocks[0].startMessageId, 1)
  assert.equal(result.blocks[0].endMessageId, 6)
})

test('expansion does not cross into another parent', () => {
  const reader = makeReader(makeMessages(1, 20))
  // 命中在 parent [1,10] 末尾，扩展不能进入 parent [11,20]
  const result = assembleEvidence(reader, [hit('c1', [1, 10], [9, 10], 1)], { expandMessages: 3 })

  assert.equal(result.blocks[0].endMessageId, 10)
  assert.equal(result.blocks[0].startMessageId, 6)
})

test('merges adjacent hits in the same parent under soft cap', () => {
  const reader = makeReader(makeMessages(1, 20))
  const hits = [hit('cA', [1, 20], [5, 6], 2), hit('cB', [1, 20], [9, 10], 1)]
  const result = assembleEvidence(reader, hits, { expandMessages: 3, blockSoftCapTokens: 100000 })

  assert.equal(result.blocks.length, 1)
  assert.deepEqual(result.blocks[0].chunkIds.sort(), ['cA', 'cB'])
  assert.equal(result.blocks[0].startMessageId, 2)
  assert.equal(result.blocks[0].endMessageId, 13)
})

test('keeps hits separate when merge would exceed soft cap', () => {
  const reader = makeReader(makeMessages(1, 20))
  const hits = [hit('cA', [1, 20], [5, 6], 2), hit('cB', [1, 20], [9, 10], 1)]

  // 测得单块与合并块 token，设置 soft cap 介于两者之间
  const single = assembleEvidence(reader, [hits[0]], { expandMessages: 3, blockSoftCapTokens: 100000 })
  const mergedTokens = assembleEvidence(reader, hits, { expandMessages: 3, blockSoftCapTokens: 100000 }).blocks[0]
    .tokens
  const cap = mergedTokens - 1
  assert.ok(cap >= single.blocks[0].tokens)

  const result = assembleEvidence(reader, hits, {
    expandMessages: 3,
    blockSoftCapTokens: cap,
    totalTokens: 100000,
  })
  assert.equal(result.blocks.length, 2)
})

test('soft cap shrinks expansion without crossing the hit core', () => {
  const reader = makeReader(makeMessages(1, 20))
  const full = assembleEvidence(reader, [hit('c1', [1, 20], [10, 10], 1)], {
    expandMessages: 3,
    blockSoftCapTokens: 100000,
  })
  const coreTokens = estimateTokens(formatEvidenceMessages(makeMessages(10, 10)))
  const cap = Math.floor((full.blocks[0].tokens + coreTokens) / 2)

  const result = assembleEvidence(reader, [hit('c1', [1, 20], [10, 10], 1)], {
    expandMessages: 3,
    blockSoftCapTokens: cap,
  })
  const block = result.blocks[0]
  assert.ok(block.tokens <= cap)
  assert.ok(block.messages.length < 7)
  // core 消息必须保留
  assert.ok(block.messages.some((m) => m.id === 10))
})

test('total budget drops lowest-score blocks first', () => {
  const all = [...makeMessages(1, 10), ...makeMessages(11, 20), ...makeMessages(21, 30)]
  const reader = makeReader(all)
  const hits = [
    hit('cHigh', [1, 10], [5, 5], 3),
    hit('cMid', [11, 20], [15, 15], 2),
    hit('cLow', [21, 30], [25, 25], 1),
  ]

  const oneBlockTokens = assembleEvidence(reader, [hits[0]], { expandMessages: 0 }).blocks[0].tokens
  // 预算只够约 2 个最小块（expand=0 时核心块）
  const result = assembleEvidence(reader, hits, {
    expandMessages: 0,
    totalTokens: oneBlockTokens * 2 + 1,
  })

  const survivingChunks = result.blocks.flatMap((b) => b.chunkIds)
  assert.ok(survivingChunks.includes('cHigh'))
  assert.ok(!survivingChunks.includes('cLow'))
  assert.ok(result.totalTokens <= oneBlockTokens * 2 + 1)
})
