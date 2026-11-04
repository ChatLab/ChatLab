import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
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

/** 复现上一版建的 embedding_index.db：同样的列，但没有复用索引，且写了一条已索引的 chunk */
function createStoreFileWithoutReuseIndex(): { dbPath: string; embedding: Float32Array } {
  const dbPath = makeTempDbPath()
  const db = new Database(dbPath)
  sqliteVec.load(db)
  db.exec(`
    CREATE TABLE chunk_vector_index (
      rowid INTEGER PRIMARY KEY,
      chunk_id TEXT NOT NULL UNIQUE,
      db_path_hash TEXT NOT NULL,
      strategy_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      dim INTEGER NOT NULL,
      parent_id TEXT NOT NULL,
      start_message_id INTEGER NOT NULL,
      end_message_id INTEGER NOT NULL,
      start_ts INTEGER NOT NULL,
      end_ts INTEGER NOT NULL,
      message_count INTEGER NOT NULL,
      raw_content_hash TEXT NOT NULL,
      embedding_input_hash TEXT NOT NULL,
      chunker_version TEXT NOT NULL,
      chunker_config_hash TEXT NOT NULL,
      indexed_at INTEGER NOT NULL,
      status TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE chunk_vec_4 USING vec0(
      vector_id INTEGER PRIMARY KEY,
      db_path_hash TEXT PARTITION KEY,
      model_id TEXT PARTITION KEY,
      embedding FLOAT[4] distance_metric=cosine
    );
  `)
  const embedding = new Float32Array([0.5, 0.25, 0.125, 0.0625])
  const inserted = db
    .prepare(
      `INSERT INTO chunk_vector_index (
         chunk_id, db_path_hash, strategy_id, model_id, dim, parent_id, start_message_id, end_message_id,
         start_ts, end_ts, message_count, raw_content_hash, embedding_input_hash, chunker_version,
         chunker_config_hash, indexed_at, status
       ) VALUES ('old', 'dbA', 'balanced', 'qwen3', 4, 'parent-1', 100, 120, 1, 2, 8, 'raw', 'emb-old', 'v1.3', 'cfg', 3, 'indexed')`
    )
    .run()
  db.prepare(
    'INSERT INTO chunk_vec_4 (vector_id, db_path_hash, model_id, embedding) VALUES (CAST(? AS INTEGER), ?, ?, ?)'
  ).run(
    Number(inserted.lastInsertRowid),
    'dbA',
    'qwen3',
    Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength)
  )
  db.close()
  return { dbPath, embedding }
}

const REUSE_LOOKUP = {
  modelId: 'qwen3',
  strategyId: 'balanced',
  chunkerVersion: 'v1.0',
  chunkerConfigHash: 'cfg-1',
  dim: 4,
  embeddingInputHash: 'emb-1',
} as const

test('findReusableVector returns a vector that copies into another database with zero distance', () => {
  const dbPath = makeTempDbPath()
  const store = new EmbeddingIndexStore(dbPath)
  const source = new Float32Array([0.5, 0.25, 0.125, 0.0625])
  store.insertChunk(baseRecord({ chunkId: 'source', dbPathHash: 'dbA' }), source)

  const hit = store.findReusableVector({ ...REUSE_LOOKUP, excludeDbPathHash: 'dbB' })
  assert.ok(hit, 'a chunk whose embedding input hash and identity match is reusable')

  // 复制到另一个聊天库后，与源向量的 cosine 距离为 0（向量确实被搬过去了）
  store.insertChunk(baseRecord({ chunkId: 'copy', dbPathHash: 'dbB' }), hit.embedding)
  const [nearest] = store.queryDense({
    dbPathHash: 'dbB',
    modelId: 'qwen3',
    dim: 4,
    embedding: source,
    k: 10,
  })
  assert.equal(nearest.chunkId, 'copy')
  assert.equal(nearest.distance, 0)

  store.close()
})

test('findReusableVector misses on a different identity, a different input or the excluded database', () => {
  const dbPath = makeTempDbPath()
  const store = new EmbeddingIndexStore(dbPath)
  store.insertChunk(baseRecord({ chunkId: 'source', dbPathHash: 'dbA' }), [1, 0, 0, 0])
  store.insertChunk(
    baseRecord({ chunkId: 'unindexed', dbPathHash: 'dbA', embeddingInputHash: 'emb-2', status: 'pending' }),
    [1, 0, 0, 0]
  )

  const lookup = { ...REUSE_LOOKUP, excludeDbPathHash: 'dbB' }
  assert.ok(store.findReusableVector(lookup))

  const misses: Array<[string, Parameters<EmbeddingIndexStore['findReusableVector']>[0]]> = [
    ['other model', { ...lookup, modelId: 'other' }],
    ['other chunker version', { ...lookup, chunkerVersion: 'v9.9' }],
    ['other chunker config', { ...lookup, chunkerConfigHash: 'cfg-9' }],
    ['other dim', { ...lookup, dim: 8 }],
    ['other embedding input', { ...lookup, embeddingInputHash: 'missing' }],
    ['own database excluded', { ...lookup, excludeDbPathHash: 'dbA' }],
    ['chunk not indexed yet', { ...lookup, embeddingInputHash: 'emb-2' }],
  ]
  for (const [label, params] of misses) {
    assert.equal(store.findReusableVector(params), null, `${label} must not be reusable`)
  }

  store.close()
})

test('chunks indexed by an earlier version are reusable without any backfill', () => {
  const { dbPath, embedding } = createStoreFileWithoutReuseIndex()
  const store = new EmbeddingIndexStore(dbPath)

  const hit = store.findReusableVector({
    modelId: 'qwen3',
    strategyId: 'balanced',
    chunkerVersion: 'v1.3',
    chunkerConfigHash: 'cfg',
    dim: 4,
    embeddingInputHash: 'emb-old',
    excludeDbPathHash: 'dbB',
  })
  assert.ok(hit)
  assert.deepEqual(new Float32Array(hit.embedding.buffer, hit.embedding.byteOffset, 4), embedding)

  store.close()
})
