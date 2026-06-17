import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { EmbeddingIndexStore } from './store'
import type { ChunkRecord } from './types'

function makeTempDbPath(): string {
  const baseDir = fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir()
  const dir = fs.mkdtempSync(path.join(baseDir, 'chatlab-embidx-'))
  return path.join(dir, 'embedding_index.db')
}

function baseRecord(overrides: Partial<ChunkRecord> = {}): ChunkRecord {
  return {
    chunkId: 'chunk-1',
    dbPathHash: 'dbA',
    strategyId: 'balanced',
    modelId: 'qwen3',
    dim: 4,
    parentId: 'parent-1',
    startMessageId: 100,
    endMessageId: 120,
    startTs: 1700000000,
    endTs: 1700000600,
    messageCount: 8,
    rawContentHash: 'raw-1',
    embeddingInputHash: 'emb-1',
    chunkerVersion: 'v1.0',
    chunkerConfigHash: 'cfg-1',
    indexedAt: 1700000700,
    status: 'indexed',
    ...overrides,
  }
}

test('insert and query dense ANN within a single partition', () => {
  const dbPath = makeTempDbPath()
  const store = new EmbeddingIndexStore(dbPath)

  store.insertChunk(baseRecord({ chunkId: 'c1' }), [1, 0, 0, 0])
  store.insertChunk(baseRecord({ chunkId: 'c2', startMessageId: 200, endMessageId: 220 }), [0, 1, 0, 0])

  const results = store.queryDense({ dbPathHash: 'dbA', modelId: 'qwen3', dim: 4, embedding: [1, 0, 0, 0], k: 10 })

  assert.equal(results.length, 2)
  assert.equal(results[0].chunkId, 'c1')
  assert.ok(results[0].distance < results[1].distance)
  assert.equal(results[0].record.parentId, 'parent-1')

  store.close()
})

test('partition pruning isolates db_path_hash and model_id', () => {
  const dbPath = makeTempDbPath()
  const store = new EmbeddingIndexStore(dbPath)

  store.insertChunk(baseRecord({ chunkId: 'a-q', dbPathHash: 'dbA', modelId: 'qwen3' }), [1, 0, 0, 0])
  store.insertChunk(baseRecord({ chunkId: 'a-b', dbPathHash: 'dbA', modelId: 'bge' }), [1, 0, 0, 0])
  store.insertChunk(baseRecord({ chunkId: 'b-q', dbPathHash: 'dbB', modelId: 'qwen3' }), [1, 0, 0, 0])

  const results = store.queryDense({ dbPathHash: 'dbA', modelId: 'qwen3', dim: 4, embedding: [1, 0, 0, 0], k: 10 })

  assert.equal(results.length, 1)
  assert.equal(results[0].chunkId, 'a-q')

  store.close()
})

test('coexisting dims are stored in separate vec0 tables and queryable', () => {
  const dbPath = makeTempDbPath()
  const store = new EmbeddingIndexStore(dbPath)

  store.insertChunk(baseRecord({ chunkId: 'small', modelId: 'bge', dim: 4 }), [1, 0, 0, 0])
  store.insertChunk(baseRecord({ chunkId: 'big', modelId: 'qwen3', dim: 8 }), [1, 0, 0, 0, 0, 0, 0, 0])

  const small = store.queryDense({ dbPathHash: 'dbA', modelId: 'bge', dim: 4, embedding: [1, 0, 0, 0], k: 10 })
  const big = store.queryDense({
    dbPathHash: 'dbA',
    modelId: 'qwen3',
    dim: 8,
    embedding: [1, 0, 0, 0, 0, 0, 0, 0],
    k: 10,
  })

  assert.equal(small.length, 1)
  assert.equal(small[0].chunkId, 'small')
  assert.equal(big.length, 1)
  assert.equal(big[0].chunkId, 'big')

  store.close()
})

test('insertChunk rejects embedding whose length mismatches dim', () => {
  const dbPath = makeTempDbPath()
  const store = new EmbeddingIndexStore(dbPath)

  assert.throws(() => store.insertChunk(baseRecord({ dim: 4 }), [1, 0, 0]), /dim/i)

  store.close()
})

test('mapMessageToChunk returns the chunk whose range covers the message', () => {
  const dbPath = makeTempDbPath()
  const store = new EmbeddingIndexStore(dbPath)

  store.insertChunk(baseRecord({ chunkId: 'c1', startMessageId: 0, endMessageId: 11 }), [1, 0, 0, 0])
  store.insertChunk(baseRecord({ chunkId: 'c2', startMessageId: 12, endMessageId: 23 }), [0, 1, 0, 0])
  store.insertChunk(baseRecord({ chunkId: 'c3', startMessageId: 24, endMessageId: 35 }), [0, 0, 1, 0])

  const params = { dbPathHash: 'dbA', modelId: 'qwen3', strategyId: 'balanced' }
  assert.equal(store.mapMessageToChunk({ ...params, messageId: 15 })?.chunkId, 'c2')
  assert.equal(store.mapMessageToChunk({ ...params, messageId: 0 })?.chunkId, 'c1')
  assert.equal(store.mapMessageToChunk({ ...params, messageId: 35 })?.chunkId, 'c3')

  store.close()
})

test('mapMessageToChunk returns null when message falls in a gap between chunks', () => {
  const dbPath = makeTempDbPath()
  const store = new EmbeddingIndexStore(dbPath)

  // chunk 之间留空洞：12-99 没有任何 chunk 覆盖
  store.insertChunk(baseRecord({ chunkId: 'c1', startMessageId: 0, endMessageId: 11 }), [1, 0, 0, 0])
  store.insertChunk(baseRecord({ chunkId: 'c2', startMessageId: 100, endMessageId: 111 }), [0, 1, 0, 0])

  const params = { dbPathHash: 'dbA', modelId: 'qwen3', strategyId: 'balanced' }
  assert.equal(store.mapMessageToChunk({ ...params, messageId: 50 }), null)
  assert.equal(store.mapMessageToChunk({ ...params, messageId: 200 }), null)

  store.close()
})

test('data persists across store reopen', () => {
  const dbPath = makeTempDbPath()
  const store = new EmbeddingIndexStore(dbPath)
  store.insertChunk(baseRecord({ chunkId: 'persist' }), [1, 0, 0, 0])
  store.close()

  const reopened = new EmbeddingIndexStore(dbPath)
  const fetched = reopened.getChunkById('persist')
  assert.equal(fetched?.chunkId, 'persist')
  assert.equal(fetched?.dim, 4)
  reopened.close()
})

test('insertChunks writes a batch in one transaction', () => {
  const dbPath = makeTempDbPath()
  const store = new EmbeddingIndexStore(dbPath)

  store.insertChunks([
    { record: baseRecord({ chunkId: 'b1', startMessageId: 0, endMessageId: 9 }), embedding: [1, 0, 0, 0] },
    { record: baseRecord({ chunkId: 'b2', startMessageId: 10, endMessageId: 19 }), embedding: [0, 1, 0, 0] },
  ])

  const results = store.queryDense({ dbPathHash: 'dbA', modelId: 'qwen3', dim: 4, embedding: [0, 1, 0, 0], k: 10 })
  assert.equal(results.length, 2)
  assert.equal(results[0].chunkId, 'b2')

  store.close()
})
