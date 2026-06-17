import assert from 'node:assert/strict'
import test from 'node:test'
import { reciprocalRankFusion } from './rrf'

test('single list preserves order with descending scores', () => {
  const result = reciprocalRankFusion([['a', 'b', 'c']], 60)
  assert.deepEqual(
    result.map((r) => r.id),
    ['a', 'b', 'c']
  )
  assert.ok(result[0].score > result[1].score && result[1].score > result[2].score)
  assert.ok(Math.abs(result[0].score - 1 / 60) < 1e-9)
})

test('items present in both lists outrank items in one list', () => {
  // x 在两个列表都靠前；y 仅在 dense 第一；z 仅在 fts 第一
  const dense = ['y', 'x']
  const fts = ['z', 'x']
  const result = reciprocalRankFusion([dense, fts], 60)
  assert.equal(result[0].id, 'x')
})

test('item appearing in only one list still scored', () => {
  const result = reciprocalRankFusion([['a'], ['b']], 60)
  const ids = result.map((r) => r.id)
  assert.ok(ids.includes('a') && ids.includes('b'))
  assert.ok(Math.abs(result[0].score - result[1].score) < 1e-9)
})

test('ties break by first-seen order for stability', () => {
  const result = reciprocalRankFusion([['a', 'b']], 60)
  // a 与 b 不同分，但验证同分场景：两个独立单元素列表同 rank
  const tie = reciprocalRankFusion([['a'], ['b']], 60)
  assert.deepEqual(
    tie.map((r) => r.id),
    ['a', 'b']
  )
  assert.equal(result[0].id, 'a')
})

test('smaller k increases score separation between ranks', () => {
  const small = reciprocalRankFusion([['a', 'b']], 1)
  const large = reciprocalRankFusion([['a', 'b']], 1000)
  const smallGap = small[0].score - small[1].score
  const largeGap = large[0].score - large[1].score
  assert.ok(smallGap > largeGap)
})

test('empty input returns empty array', () => {
  assert.deepEqual(reciprocalRankFusion([], 60), [])
  assert.deepEqual(reciprocalRankFusion([[], []], 60), [])
})
