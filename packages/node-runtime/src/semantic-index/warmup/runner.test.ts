import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { runWarmup, type SemanticMessageSource, type StopSignal } from './runner'
import { EmbeddingIndexStore } from '../store'
import { SemanticIndexStateStore } from '../session-state-store'
import { DEFAULT_CHUNKER_CONFIG, type ChunkerConfig } from '../chunker-config'
import type { EmbeddingProvider } from '../embedding/types'
import type { ChunkMessageInput } from '../chunker'

const MINUTE = 60_000
const DB_HASH = 'dbA'
const MODEL = 'fake'

function makeTempDir(): string {
  const baseDir = fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir()
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-warmup-'))
}

// overlap=0、单 parent、小字符上限：每 2 条消息一个 chunk
const config: ChunkerConfig = {
  ...DEFAULT_CHUNKER_CONFIG,
  parentGapSeconds: 100000,
  parentMaxTokens: 100000,
  childTargetMaxChars: 30,
  childHardMaxTokens: 100000,
  overlapMessages: 0,
  semanticVoidSkipThreshold: 1,
}

function makeMessages(count: number): ChunkMessageInput[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    senderName: '张三',
    content: '这是一条二十个字左右的测试消息内容',
    ts: i * 0.1 * MINUTE,
  }))
}

function makeSource(messages: ChunkMessageInput[]): SemanticMessageSource {
  return {
    getSource: () => ({ title: '测试群', kind: 'group' }),
    countMessages: () => messages.length,
    readAllMessages: () => messages,
  }
}

class FakeEmbedder implements EmbeddingProvider {
  readonly modelId = MODEL
  readonly dim = 4
  readonly maxTokens = 1000
  calls = 0
  failAtCall?: number

  async embedDocuments(texts: string[]): Promise<Float32Array[]> {
    return texts.map(() => {
      this.calls++
      if (this.failAtCall && this.calls >= this.failAtCall) throw new Error('boom')
      return new Float32Array([1, 0, 0, 0])
    })
  }

  async embedQuery(text: string): Promise<Float32Array> {
    return (await this.embedDocuments([text]))[0]
  }
}

function setup(messages: ChunkMessageInput[]) {
  const dir = makeTempDir()
  const dbPath = path.join(dir, 'embedding_index.db')
  const store = new EmbeddingIndexStore(dbPath)
  const stateStore = new SemanticIndexStateStore(dbPath)
  stateStore.enable({
    dbPathHash: DB_HASH,
    dbPath: '/chat/a.db',
    modelId: MODEL,
    chunkerVersion: 'v1.1',
    chunkerConfigHash: 'cfg',
  })
  return { store, stateStore, source: makeSource(messages) }
}

function countStored(store: EmbeddingIndexStore): number {
  return store.queryDense({ dbPathHash: DB_HASH, modelId: MODEL, dim: 4, embedding: [1, 0, 0, 0], k: 1000 }).length
}

test('full warmup writes all chunks and marks completed', async () => {
  const { store, stateStore, source } = setup(makeMessages(8))
  const embedder = new FakeEmbedder()

  const result = await runWarmup({ dbPathHash: DB_HASH, modelId: MODEL, embedder, store, stateStore, source, config })

  assert.equal(result.status, 'completed')
  assert.equal(result.chunksWritten, 4)
  assert.equal(countStored(store), 4)

  const state = stateStore.getState(DB_HASH)!
  assert.equal(state.indexStatus, 'completed')
  assert.equal(state.chunkCount, 4)
  assert.equal(state.totalMessages, 8)
  assert.equal(state.indexedMessages, 8)
  store.close()
  stateStore.close()
})

test('pause then resume completes without duplicate inserts', async () => {
  const { store, stateStore, source } = setup(makeMessages(8))
  const embedder = new FakeEmbedder()

  let calls = 0
  const pauseOnThird: StopSignal = () => (++calls >= 3 ? 'paused' : null)
  const paused = await runWarmup({
    dbPathHash: DB_HASH,
    modelId: MODEL,
    embedder,
    store,
    stateStore,
    source,
    config,
    checkStop: pauseOnThird,
  })

  assert.equal(paused.status, 'paused')
  assert.equal(paused.chunksWritten, 2)
  assert.equal(countStored(store), 2)
  assert.equal(stateStore.getState(DB_HASH)!.indexStatus, 'paused')

  const resumed = await runWarmup({ dbPathHash: DB_HASH, modelId: MODEL, embedder, store, stateStore, source, config })
  assert.equal(resumed.status, 'completed')
  assert.equal(resumed.chunksWritten, 2)
  assert.equal(countStored(store), 4)
  assert.equal(stateStore.getState(DB_HASH)!.chunkCount, 4)
  store.close()
  stateStore.close()
})

test('cancellation stops immediately and records cancelled state', async () => {
  const { store, stateStore, source } = setup(makeMessages(8))
  const embedder = new FakeEmbedder()

  const result = await runWarmup({
    dbPathHash: DB_HASH,
    modelId: MODEL,
    embedder,
    store,
    stateStore,
    source,
    config,
    checkStop: () => 'cancelled',
  })

  assert.equal(result.status, 'cancelled')
  assert.equal(result.chunksWritten, 0)
  assert.equal(countStored(store), 0)
  assert.equal(stateStore.getState(DB_HASH)!.indexStatus, 'cancelled')
  store.close()
  stateStore.close()
})

test('embedding failure marks failed and preserves partial progress', async () => {
  const { store, stateStore, source } = setup(makeMessages(8))
  const embedder = new FakeEmbedder()
  embedder.failAtCall = 2

  const result = await runWarmup({ dbPathHash: DB_HASH, modelId: MODEL, embedder, store, stateStore, source, config })

  assert.equal(result.status, 'failed')
  assert.equal(result.error, 'boom')
  assert.equal(result.chunksWritten, 1)
  assert.equal(countStored(store), 1)
  const state = stateStore.getState(DB_HASH)!
  assert.equal(state.indexStatus, 'failed')
  assert.equal(state.error, 'boom')
  store.close()
  stateStore.close()
})

test('empty conversation completes with zero chunks', async () => {
  const { store, stateStore, source } = setup([])
  const embedder = new FakeEmbedder()

  const result = await runWarmup({ dbPathHash: DB_HASH, modelId: MODEL, embedder, store, stateStore, source, config })

  assert.equal(result.status, 'completed')
  assert.equal(result.chunksWritten, 0)
  assert.equal(stateStore.getState(DB_HASH)!.indexStatus, 'completed')
  store.close()
  stateStore.close()
})
