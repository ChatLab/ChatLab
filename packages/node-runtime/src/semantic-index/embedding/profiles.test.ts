import assert from 'node:assert/strict'
import test from 'node:test'
import { BGE_PROFILE, QWEN3_PROFILE, getLocalProfileByModelId, getLocalProfilesForLocale } from './profiles'
import { applyQueryInstruction, clampTextChars } from './text'

test('BGE profile matches P0-2 conclusion', () => {
  assert.equal(BGE_PROFILE.modelId, 'Xenova/bge-small-zh-v1.5')
  assert.equal(BGE_PROFILE.dim, 512)
  assert.equal(BGE_PROFILE.pooling, 'cls')
  assert.equal(BGE_PROFILE.normalize, true)
  assert.ok(BGE_PROFILE.queryInstruction.length > 0)
})

test('Qwen3 profile enforces batch=1 and last_token pooling', () => {
  assert.equal(QWEN3_PROFILE.modelId, 'onnx-community/Qwen3-Embedding-0.6B-ONNX')
  assert.equal(QWEN3_PROFILE.dim, 1024)
  assert.equal(QWEN3_PROFILE.pooling, 'last_token')
  assert.equal(QWEN3_PROFILE.normalize, true)
  assert.equal(QWEN3_PROFILE.dtype, 'q8')
  assert.equal(QWEN3_PROFILE.maxBatchSize, 1)
  assert.equal(QWEN3_PROFILE.maxTextChars, 2400)
})

test('locale registry exposes BGE only to Chinese UI', () => {
  const zh = getLocalProfilesForLocale('zh-CN')
  assert.deepEqual(
    zh.map((p) => p.modelId),
    [BGE_PROFILE.modelId, QWEN3_PROFILE.modelId]
  )

  for (const locale of ['en-US', 'ja-JP']) {
    const profiles = getLocalProfilesForLocale(locale)
    assert.deepEqual(
      profiles.map((p) => p.modelId),
      [QWEN3_PROFILE.modelId]
    )
  }
})

test('getLocalProfileByModelId resolves known models and null otherwise', () => {
  assert.equal(getLocalProfileByModelId(BGE_PROFILE.modelId)?.dim, 512)
  assert.equal(getLocalProfileByModelId(QWEN3_PROFILE.modelId)?.dim, 1024)
  assert.equal(getLocalProfileByModelId('unknown/model'), null)
})

test('applyQueryInstruction prefixes query, no-op on empty instruction', () => {
  assert.equal(applyQueryInstruction('指令：', '查询内容'), '指令：查询内容')
  assert.equal(applyQueryInstruction('   ', '查询内容'), '查询内容')
})

test('clampTextChars truncates only when over the limit', () => {
  assert.equal(clampTextChars('abcdef', 3), 'abc')
  assert.equal(clampTextChars('abc', 10), 'abc')
  assert.equal(clampTextChars('abc'), 'abc')
})
