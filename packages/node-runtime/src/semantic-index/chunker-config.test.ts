import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CHUNKER_VERSION,
  DEFAULT_CHUNKER_CONFIG,
  computeChunkerConfigHash,
  computeDbPathHash,
  deriveParentId,
  type ChunkerConfig,
} from './chunker-config'

test('computeChunkerConfigHash is deterministic for equal configs', () => {
  const a = computeChunkerConfigHash(DEFAULT_CHUNKER_CONFIG)
  const b = computeChunkerConfigHash({ ...DEFAULT_CHUNKER_CONFIG })
  assert.equal(a, b)
  assert.match(a, /^[0-9a-f]{64}$/)
})

test('computeChunkerConfigHash is independent of object key order', () => {
  const reordered: ChunkerConfig = {
    semanticVoidSkipThreshold: DEFAULT_CHUNKER_CONFIG.semanticVoidSkipThreshold,
    overlapMessages: DEFAULT_CHUNKER_CONFIG.overlapMessages,
    childHardMaxTokens: DEFAULT_CHUNKER_CONFIG.childHardMaxTokens,
    childHardMaxMessages: DEFAULT_CHUNKER_CONFIG.childHardMaxMessages,
    childSoftMaxMessages: DEFAULT_CHUNKER_CONFIG.childSoftMaxMessages,
    childTargetMaxChars: DEFAULT_CHUNKER_CONFIG.childTargetMaxChars,
    childTargetMinChars: DEFAULT_CHUNKER_CONFIG.childTargetMinChars,
    parentMaxTokens: DEFAULT_CHUNKER_CONFIG.parentMaxTokens,
    parentGapSeconds: DEFAULT_CHUNKER_CONFIG.parentGapSeconds,
  }
  assert.equal(computeChunkerConfigHash(reordered), computeChunkerConfigHash(DEFAULT_CHUNKER_CONFIG))
})

test('computeChunkerConfigHash changes when any field changes', () => {
  const base = computeChunkerConfigHash(DEFAULT_CHUNKER_CONFIG)
  const keys: (keyof ChunkerConfig)[] = [
    'parentGapSeconds',
    'parentMaxTokens',
    'childTargetMinChars',
    'childTargetMaxChars',
    'childSoftMaxMessages',
    'childHardMaxMessages',
    'childHardMaxTokens',
    'overlapMessages',
    'semanticVoidSkipThreshold',
  ]
  for (const key of keys) {
    const mutated = { ...DEFAULT_CHUNKER_CONFIG, [key]: DEFAULT_CHUNKER_CONFIG[key] + 1 }
    assert.notEqual(computeChunkerConfigHash(mutated), base, `hash should change when ${key} changes`)
  }
})

test('computeDbPathHash is a stable 16-char hex prefix and path-sensitive', () => {
  const h1 = computeDbPathHash('/data/a.db')
  const h2 = computeDbPathHash('/data/a.db')
  const h3 = computeDbPathHash('/data/b.db')
  assert.equal(h1, h2)
  assert.notEqual(h1, h3)
  assert.match(h1, /^[0-9a-f]{16}$/)
})

test('deriveParentId embeds range, gap, version and config hash', () => {
  const id = deriveParentId({
    startMessageId: 100,
    endMessageId: 220,
    gapSeconds: 1800,
    chunkerVersion: CHUNKER_VERSION,
    chunkerConfigHash: 'cfgabc',
  })
  assert.equal(id, `parent:100:220:1800:${CHUNKER_VERSION}:cfgabc`)
})

test('deriveParentId differs when config hash differs', () => {
  const common = { startMessageId: 1, endMessageId: 9, gapSeconds: 1800, chunkerVersion: CHUNKER_VERSION }
  assert.notEqual(
    deriveParentId({ ...common, chunkerConfigHash: 'x' }),
    deriveParentId({ ...common, chunkerConfigHash: 'y' })
  )
})
