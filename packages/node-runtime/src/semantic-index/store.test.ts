import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { EmbeddingIndexStore } from './store'
import type { ChunkRecord } from './types'

function makeTempDbPath(): string {
  const baseDir = process.env.CHATLAB_TEST_TMPDIR ?? (fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir())
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
  store.insertChunk(baseRecord({ chunkId: 'a-b', dbPathHash: 'dbA', modelId: 'modelB' }), [1, 0, 0, 0])
  store.insertChunk(baseRecord({ chunkId: 'b-q', dbPathHash: 'dbB', modelId: 'qwen3' }), [1, 0, 0, 0])

  const results = store.queryDense({ dbPathHash: 'dbA', modelId: 'qwen3', dim: 4, embedding: [1, 0, 0, 0], k: 10 })

  assert.equal(results.length, 1)
  assert.equal(results[0].chunkId, 'a-q')

  store.close()
})

test('coexisting dims are stored in separate vec0 tables and queryable', () => {
  const dbPath = makeTempDbPath()
  const store = new EmbeddingIndexStore(dbPath)

  store.insertChunk(baseRecord({ chunkId: 'small', modelId: 'modelB', dim: 4 }), [1, 0, 0, 0])
  store.insertChunk(baseRecord({ chunkId: 'big', modelId: 'qwen3', dim: 8 }), [1, 0, 0, 0, 0, 0, 0, 0])

  const small = store.queryDense({ dbPathHash: 'dbA', modelId: 'modelB', dim: 4, embedding: [1, 0, 0, 0], k: 10 })
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

test('mapMessageToChunk returns the chunk whose ts range covers the message', () => {
  const dbPath = makeTempDbPath()
  const store = new EmbeddingIndexStore(dbPath)

  // ts 用 messageId * 100 映射，三段连续
  store.insertChunk(
    baseRecord({ chunkId: 'c1', startMessageId: 0, endMessageId: 11, startTs: 0, endTs: 1100 }),
    [1, 0, 0, 0]
  )
  store.insertChunk(
    baseRecord({ chunkId: 'c2', startMessageId: 12, endMessageId: 23, startTs: 1200, endTs: 2300 }),
    [0, 1, 0, 0]
  )
  store.insertChunk(
    baseRecord({ chunkId: 'c3', startMessageId: 24, endMessageId: 35, startTs: 2400, endTs: 3500 }),
    [0, 0, 1, 0]
  )

  const params = { dbPathHash: 'dbA', modelId: 'qwen3', strategyId: 'balanced' }
  assert.equal(store.mapMessageToChunk({ ...params, messageId: 15, messageTs: 1500 })?.chunkId, 'c2')
  assert.equal(store.mapMessageToChunk({ ...params, messageId: 0, messageTs: 0 })?.chunkId, 'c1')
  assert.equal(store.mapMessageToChunk({ ...params, messageId: 35, messageTs: 3500 })?.chunkId, 'c3')

  store.close()
})

test('mapMessageToChunk returns null when message ts falls in a gap between chunks', () => {
  const dbPath = makeTempDbPath()
  const store = new EmbeddingIndexStore(dbPath)

  // chunk 之间留 ts 空洞
  store.insertChunk(
    baseRecord({ chunkId: 'c1', startMessageId: 0, endMessageId: 11, startTs: 0, endTs: 1100 }),
    [1, 0, 0, 0]
  )
  store.insertChunk(
    baseRecord({ chunkId: 'c2', startMessageId: 100, endMessageId: 111, startTs: 10000, endTs: 11100 }),
    [0, 1, 0, 0]
  )

  const params = { dbPathHash: 'dbA', modelId: 'qwen3', strategyId: 'balanced' }
  assert.equal(store.mapMessageToChunk({ ...params, messageId: 50, messageTs: 5000 }), null)
  assert.equal(store.mapMessageToChunk({ ...params, messageId: 200, messageTs: 20000 }), null)

  store.close()
})

test('mapMessageToChunk breaks ties when multiple chunks share the same start_ts', () => {
  const dbPath = makeTempDbPath()
  const store = new EmbeddingIndexStore(dbPath)

  // 同一秒内两个 chunk：c1 覆盖 id 1-2，c2 覆盖 id 3-4，start_ts 相同
  store.insertChunk(
    baseRecord({ chunkId: 'c1', startMessageId: 1, endMessageId: 2, startTs: 1000, endTs: 1000 }),
    [1, 0, 0, 0]
  )
  store.insertChunk(
    baseRecord({ chunkId: 'c2', startMessageId: 3, endMessageId: 4, startTs: 1000, endTs: 1000 }),
    [0, 1, 0, 0]
  )

  const params = { dbPathHash: 'dbA', modelId: 'qwen3', strategyId: 'balanced' }
  assert.equal(store.mapMessageToChunk({ ...params, messageId: 1, messageTs: 1000 })?.chunkId, 'c1')
  assert.equal(store.mapMessageToChunk({ ...params, messageId: 3, messageTs: 1000 })?.chunkId, 'c2')
  assert.equal(store.mapMessageToChunk({ ...params, messageId: 4, messageTs: 1000 })?.chunkId, 'c2')

  store.close()
})

test('schema includes timestamp-leading index for message-to-chunk lookup', () => {
  const dbPath = makeTempDbPath()
  const store = new EmbeddingIndexStore(dbPath)
  store.close()

  const db = new Database(dbPath, { readonly: true })
  const indexes = db.pragma('index_list(chunk_vector_index)') as { name: string }[]
  const timestampIndex = indexes.find((index) => index.name === 'idx_chunk_ts_range')
  assert.ok(timestampIndex, 'expected idx_chunk_ts_range to exist')

  const columns = (db.pragma(`index_info(${timestampIndex.name})`) as { name: string }[]).map((column) => column.name)
  assert.deepEqual(columns, ['db_path_hash', 'model_id', 'strategy_id', 'start_ts', 'start_message_id'])
  db.close()
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
