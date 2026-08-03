import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { semanticSearch } from './semantic-search'
import { EmbeddingIndexStore } from '../store'
import { STRATEGY_ID } from '../chunker-config'
import type { EmbeddingProvider } from '../embedding/types'
import type { ChunkRecord } from '../types'

const DB_HASH = 'dbA'
const MODEL = 'fake'
const DIM = 4

function makeTempDir(): string {
  const baseDir = process.env.CHATLAB_TEST_TMPDIR ?? (fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir())
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-semantic-search-'))
}

function makeRecord(chunkId: string, startMessageId: number, endMessageId: number): ChunkRecord {
  return {
    chunkId,
    dbPathHash: DB_HASH,
    strategyId: STRATEGY_ID,
    modelId: MODEL,
    dim: DIM,
    parentId: `parent:${startMessageId}`,
    startMessageId,
    endMessageId,
    startTs: startMessageId * 1000,
    endTs: endMessageId * 1000,
    messageCount: endMessageId - startMessageId + 1,
    rawContentHash: `raw-${chunkId}`,
    embeddingInputHash: `emb-${chunkId}`,
    chunkerVersion: 'v1.0',
    chunkerConfigHash: 'cfg',
    indexedAt: Date.now(),
    status: 'indexed',
  }
}

function makeEmbedder(queryVector: number[]): EmbeddingProvider {
  return {
    modelId: MODEL,
    dim: DIM,
    maxTokens: 1000,
    async embedDocuments(texts) {
      return texts.map(() => new Float32Array(queryVector))
    },
    async embedQuery() {
      return new Float32Array(queryVector)
    },
  }
}

function setupStore() {
  const dir = makeTempDir()
  const store = new EmbeddingIndexStore(path.join(dir, 'embedding_index.db'))
  store.insertChunk(makeRecord('c1', 1, 2), [1, 0, 0, 0])
  store.insertChunk(makeRecord('c2', 3, 4), [0, 1, 0, 0])
  store.insertChunk(makeRecord('c3', 5, 6), [0, 0, 1, 0])
  store.insertChunk(makeRecord('c4', 7, 8), [0, 0, 0, 1])
  return store
}

const baseParams = {
  query: '测试问题',
  dbPathHash: DB_HASH,
  modelId: MODEL,
  dim: DIM,
}

test('returns dense results in similarity order with stable ranks', async () => {
  const store = setupStore()
  const embedder = makeEmbedder([0.9, 0.1, 0, 0])

  const results = await semanticSearch({ embedder, store }, baseParams)

  assert.equal(results[0].chunkId, 'c1')
  assert.equal(results[0].denseRank, 0)
  assert.equal(results[1].denseRank, 1)
  assert.ok(results[0].score >= results[1].score)
  store.close()
})

test('respects finalTopK limit', async () => {
  const store = setupStore()
  const embedder = makeEmbedder([0.9, 0.1, 0, 0])

  const results = await semanticSearch({ embedder, store }, { ...baseParams, finalTopK: 2 })
  assert.equal(results.length, 2)
  store.close()
})

test('empty query returns no results', async () => {
  const store = setupStore()
  const embedder = makeEmbedder([1, 0, 0, 0])

  const results = await semanticSearch({ embedder, store }, { ...baseParams, query: '   ' })
  assert.deepEqual(results, [])
  store.close()
})

// Chunk ranges use milliseconds (makeRecord uses messageId * 1000).
// c1: 1000-2000, c2: 3000-4000, c3: 5000-6000, c4: 7000-8000
test('timeRangeMs filters out chunks with no overlap', async () => {
  const store = setupStore()
  const embedder = makeEmbedder([0.5, 0.5, 0.5, 0.5])

  const results = await semanticSearch(
    { embedder, store },
    { ...baseParams, timeRangeMs: { startTs: 4500, endTs: 9000 } }
  )
  const ids = results.map((r) => r.chunkId).sort()
  assert.deepEqual(ids, ['c3', 'c4'])
  store.close()
})

test('timeRangeMs keeps chunks overlapping the range', async () => {
  const store = setupStore()
  const embedder = makeEmbedder([0.5, 0.5, 0.5, 0.5])

  const results = await semanticSearch(
    { embedder, store },
    { ...baseParams, timeRangeMs: { startTs: 1500, endTs: 3500 } }
  )
  const ids = results.map((r) => r.chunkId).sort()
  assert.deepEqual(ids, ['c1', 'c2'])
  store.close()
})

test('timeRangeMs supports single-sided startTs', async () => {
  const store = setupStore()
  const embedder = makeEmbedder([0.5, 0.5, 0.5, 0.5])

  const results = await semanticSearch({ embedder, store }, { ...baseParams, timeRangeMs: { startTs: 5000 } })
  const ids = results.map((r) => r.chunkId).sort()
  assert.deepEqual(ids, ['c3', 'c4'])
  store.close()
})

test('timeRangeMs supports single-sided endTs', async () => {
  const store = setupStore()
  const embedder = makeEmbedder([0.5, 0.5, 0.5, 0.5])

  const results = await semanticSearch({ embedder, store }, { ...baseParams, timeRangeMs: { endTs: 4000 } })
  const ids = results.map((r) => r.chunkId).sort()
  assert.deepEqual(ids, ['c1', 'c2'])
  store.close()
})
