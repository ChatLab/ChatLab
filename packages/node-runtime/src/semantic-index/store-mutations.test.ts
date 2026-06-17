import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { EmbeddingIndexStore } from './store'
import { STRATEGY_ID } from './chunker-config'
import type { ChunkRecord } from './types'

function makeStore() {
  const baseDir = fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir()
  const dir = fs.mkdtempSync(path.join(baseDir, 'chatlab-store-mut-'))
  return new EmbeddingIndexStore(path.join(dir, 'embedding_index.db'))
}

function record(chunkId: string, dbPathHash: string, modelId: string, dim: number, start: number): ChunkRecord {
  return {
    chunkId,
    dbPathHash,
    strategyId: STRATEGY_ID,
    modelId,
    dim,
    parentId: `parent:${start}`,
    startMessageId: start,
    endMessageId: start + 1,
    startTs: start * 1000,
    endTs: (start + 1) * 1000,
    messageCount: 2,
    rawContentHash: `raw-${chunkId}`,
    embeddingInputHash: `emb-${chunkId}`,
    chunkerVersion: 'v1.0',
    chunkerConfigHash: 'cfg',
    indexedAt: Date.now(),
    status: 'indexed',
  }
}

test('deleteByDbPathHash removes only the target conversation across models and dims', () => {
  const store = makeStore()
  store.insertChunk(record('a1', 'A', 'm-dim4', 4, 1), [1, 0, 0, 0])
  store.insertChunk(record('a2', 'A', 'm-dim3', 3, 3), [0, 1, 0])
  store.insertChunk(record('b1', 'B', 'm-dim4', 4, 1), [0, 0, 1, 0])

  const removed = store.deleteByDbPathHash('A')
  assert.equal(removed, 2)
  assert.equal(store.countChunks('A'), 0)
  assert.equal(store.countChunks('B'), 1)

  // 删除后 vec0 行也清掉：A 的 dim4 查询应无结果，B 仍可查到
  assert.equal(
    store.queryDense({ dbPathHash: 'A', modelId: 'm-dim4', dim: 4, embedding: [1, 0, 0, 0], k: 10 }).length,
    0
  )
  assert.equal(
    store.queryDense({ dbPathHash: 'B', modelId: 'm-dim4', dim: 4, embedding: [0, 0, 1, 0], k: 10 }).length,
    1
  )
  store.close()
})

test('listDbPathHashes returns distinct conversation hashes', () => {
  const store = makeStore()
  store.insertChunk(record('a1', 'A', 'm', 4, 1), [1, 0, 0, 0])
  store.insertChunk(record('a2', 'A', 'm', 4, 3), [0, 1, 0, 0])
  store.insertChunk(record('b1', 'B', 'm', 4, 1), [0, 0, 1, 0])

  assert.deepEqual(store.listDbPathHashes().sort(), ['A', 'B'])
  store.close()
})

test('countChunks can scope by model id', () => {
  const store = makeStore()
  store.insertChunk(record('a1', 'A', 'm1', 4, 1), [1, 0, 0, 0])
  store.insertChunk(record('a2', 'A', 'm2', 4, 3), [0, 1, 0, 0])

  assert.equal(store.countChunks('A'), 2)
  assert.equal(store.countChunks('A', 'm1'), 1)
  store.close()
})
