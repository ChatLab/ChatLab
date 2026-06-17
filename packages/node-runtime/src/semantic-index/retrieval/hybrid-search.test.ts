import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { hybridSearch, type FtsSearcher } from './hybrid-search'
import { EmbeddingIndexStore } from '../store'
import { STRATEGY_ID } from '../chunker-config'
import type { EmbeddingProvider } from '../embedding/types'
import type { ChunkRecord } from '../types'

const DB_HASH = 'dbA'
const MODEL = 'fake'
const DIM = 4

function makeTempDir(): string {
  const baseDir = fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir()
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-hybrid-'))
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
  strategyId: STRATEGY_ID,
  dim: DIM,
}

test('fuses dense and fts so a chunk hit by both ranks first', async () => {
  const store = setupStore()
  // query 最接近 c1；FTS 命中 message 5(c3) 和 7(c4)
  const embedder = makeEmbedder([0.9, 0.1, 0, 0])
  const fts: FtsSearcher = { search: () => [5, 7] }

  const results = await hybridSearch({ embedder, store, fts }, baseParams)

  // c3、c4 同时出现在 dense 与 fts，RRF 分数高于仅 dense 命中的 c1、c2
  assert.equal(results[0].chunkId, 'c3')
  assert.equal(results[1].chunkId, 'c4')
  const c3 = results[0]
  assert.equal(c3.ftsRank, 0)
  assert.notEqual(c3.denseRank, null)
  const c1 = results.find((r) => r.chunkId === 'c1')!
  assert.equal(c1.ftsRank, null)
  assert.equal(c1.denseRank, 0)
  store.close()
})

test('respects finalTopK limit', async () => {
  const store = setupStore()
  const embedder = makeEmbedder([0.9, 0.1, 0, 0])
  const fts: FtsSearcher = { search: () => [5, 7] }

  const results = await hybridSearch({ embedder, store, fts }, { ...baseParams, finalTopK: 2 })
  assert.equal(results.length, 2)
  store.close()
})

test('deduplicates fts message ids mapping to the same chunk', async () => {
  const store = setupStore()
  const embedder = makeEmbedder([1, 0, 0, 0])
  // message 5 和 6 都映射到 c3
  const fts: FtsSearcher = { search: () => [5, 6] }

  const results = await hybridSearch({ embedder, store, fts }, baseParams)
  const c3 = results.find((r) => r.chunkId === 'c3')!
  assert.equal(c3.ftsRank, 0)
  store.close()
})

test('works with dense only when fts returns nothing', async () => {
  const store = setupStore()
  const embedder = makeEmbedder([1, 0, 0, 0])
  const fts: FtsSearcher = { search: () => [] }

  const results = await hybridSearch({ embedder, store, fts }, baseParams)
  assert.equal(results[0].chunkId, 'c1')
  assert.ok(results.every((r) => r.ftsRank === null))
  store.close()
})

test('empty query returns no results', async () => {
  const store = setupStore()
  const embedder = makeEmbedder([1, 0, 0, 0])
  const fts: FtsSearcher = { search: () => [1] }

  const results = await hybridSearch({ embedder, store, fts }, { ...baseParams, query: '   ' })
  assert.deepEqual(results, [])
  store.close()
})
