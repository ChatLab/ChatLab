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
  const baseDir = process.env.CHATLAB_TEST_TMPDIR ?? (fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir())
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
  batchSizes: number[] = []
  failAtCall?: number
  afterEmbed?: () => void

  async embedDocuments(texts: string[]): Promise<Float32Array[]> {
    this.batchSizes.push(texts.length)
    return texts.map(() => {
      this.calls++
      if (this.failAtCall && this.calls >= this.failAtCall) throw new Error('boom')
      this.afterEmbed?.()
      return new Float32Array([1, 0, 0, 0])
    })
  }

  async embedQuery(text: string): Promise<Float32Array> {
    return (await this.embedDocuments([text]))[0]
  }
}

class BatchingFakeEmbedder extends FakeEmbedder {
  readonly documentBatchSize = 32
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

function storedParentIds(store: EmbeddingIndexStore): string[] {
  return store
    .queryDense({ dbPathHash: DB_HASH, modelId: MODEL, dim: 4, embedding: [1, 0, 0, 0], k: 1000 })
    .map((result) => result.record.parentId)
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

test('warmup batches document embeddings when the provider supports batches', async () => {
  const { store, stateStore, source } = setup(makeMessages(70))
  const embedder = new BatchingFakeEmbedder()

  const result = await runWarmup({ dbPathHash: DB_HASH, modelId: MODEL, embedder, store, stateStore, source, config })

  assert.equal(result.status, 'completed')
  assert.equal(result.chunksWritten, 35)
  assert.deepEqual(embedder.batchSizes, [32, 3])
  assert.equal(countStored(store), 35)
  store.close()
  stateStore.close()
})

test('pause then resume completes without duplicate inserts', async () => {
  const { store, stateStore, source } = setup(makeMessages(8))
  const embedder = new FakeEmbedder()

  let calls = 0
  const pauseAfterTwoWrittenChunks: StopSignal = () => (++calls >= 5 ? 'paused' : null)
  const paused = await runWarmup({
    dbPathHash: DB_HASH,
    modelId: MODEL,
    embedder,
    store,
    stateStore,
    source,
    config,
    checkStop: pauseAfterTwoWrittenChunks,
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

test('cancellation after embedding does not write the just-finished chunk', async () => {
  const { store, stateStore, source } = setup(makeMessages(8))
  const embedder = new FakeEmbedder()

  let cancelled = false
  embedder.afterEmbed = () => {
    cancelled = true
  }

  const result = await runWarmup({
    dbPathHash: DB_HASH,
    modelId: MODEL,
    embedder,
    store,
    stateStore,
    source,
    config,
    checkStop: () => (cancelled ? 'cancelled' : null),
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

test('backfilled older messages trigger full re-index', async () => {
  // First run: index 4 messages (ids 1-4, monotonically increasing ts)
  const original = makeMessages(4)
  const { store, stateStore } = setup(original)
  const embedder = new FakeEmbedder()

  await runWarmup({
    dbPathHash: DB_HASH,
    modelId: MODEL,
    embedder,
    store,
    stateStore,
    source: makeSource(original),
    config,
  })
  assert.equal(stateStore.getState(DB_HASH)!.indexStatus, 'completed')
  const chunksAfterFirst = countStored(store)

  // Simulate backfill: prepend 2 older messages (ids 5-6 with ts before ids 1-4)
  const backfilled: ChunkMessageInput[] = [
    { id: 5, senderName: '张三', content: '这是一条二十个字左右的测试消息内容', ts: -2 * 0.1 * MINUTE },
    { id: 6, senderName: '张三', content: '这是一条二十个字左右的测试消息内容', ts: -1 * 0.1 * MINUTE },
    ...original,
  ]

  // Second run: non-append-only additions detected → should re-index all messages
  const embedder2 = new FakeEmbedder()
  const result = await runWarmup({
    dbPathHash: DB_HASH,
    modelId: MODEL,
    embedder: embedder2,
    store,
    stateStore,
    source: makeSource(backfilled),
    config,
  })

  assert.equal(result.status, 'completed')
  // Must have more chunks than before (backfilled messages now indexed)
  assert.ok(countStored(store) > chunksAfterFirst, 'backfilled messages should produce additional chunks')
  assert.equal(stateStore.getState(DB_HASH)!.totalMessages, 6)
  store.close()
  stateStore.close()
})

test('append-only warmup replaces stale chunks from the extended tail parent', async () => {
  const original = makeMessages(4)
  const { store, stateStore } = setup(original)
  const embedder = new FakeEmbedder()

  await runWarmup({
    dbPathHash: DB_HASH,
    modelId: MODEL,
    embedder,
    store,
    stateStore,
    source: makeSource(original),
    config,
  })
  assert.equal(countStored(store), 2)
  assert.ok(storedParentIds(store).every((id) => id.includes('parent:1:4:')))

  const appended = [
    ...original,
    ...makeMessages(2).map((message) => ({ ...message, id: message.id + 4, ts: message.ts + 4 * 0.1 * MINUTE })),
  ]
  const result = await runWarmup({
    dbPathHash: DB_HASH,
    modelId: MODEL,
    embedder: new FakeEmbedder(),
    store,
    stateStore,
    source: makeSource(appended),
    config,
  })

  assert.equal(result.status, 'completed')
  assert.equal(result.chunksWritten, 3)
  assert.equal(countStored(store), 3)
  assert.ok(storedParentIds(store).every((id) => id.includes('parent:1:6:')))
  assert.equal(stateStore.getState(DB_HASH)!.chunkCount, 3)
  store.close()
  stateStore.close()
})

// ==================== 合并会话的向量复用 ====================

const SOURCE_HASH = 'dbSource'
const TARGET_HASH = 'dbTarget'
/** 第二个目标聊天库：同一批向量要被两个不同的会话分别承接时用 */
const SECOND_TARGET_HASH = 'dbTarget2'

/** 稳定的"逻辑消息"：合并后消息 id 变了，但时间、发送者与正文不变 */
function mergeMessage(logicalId: number, dbId: number): ChunkMessageInput {
  return {
    id: dbId,
    senderName: `成员${logicalId % 3}`,
    content: `第${logicalId}条内容互不相同的测试消息正文`,
    ts: logicalId * 0.1 * MINUTE,
  }
}

/** 与 makeSource 相同，但可以换会话标题（标题进 embedding 文本，换了就不该复用） */
function makeTitledSource(messages: ChunkMessageInput[], title: string): SemanticMessageSource {
  return { ...makeSource(messages), getSource: () => ({ title, kind: 'group' }) }
}

/** 返回固定向量的 embedder，用于区分"复用的旧向量"与"新算的向量" */
class ConstantEmbedder extends FakeEmbedder {
  constructor(private readonly vector: [number, number, number, number]) {
    super()
  }

  async embedDocuments(texts: string[]): Promise<Float32Array[]> {
    this.batchSizes.push(texts.length)
    return texts.map(() => {
      this.calls++
      return new Float32Array(this.vector)
    })
  }
}

function makeCarryOverFixture() {
  const dir = makeTempDir()
  const dbPath = path.join(dir, 'embedding_index.db')
  const store = new EmbeddingIndexStore(dbPath)
  const stateStore = new SemanticIndexStateStore(dbPath)
  for (const [hash, dbFile] of [
    [SOURCE_HASH, '/chat/source.db'],
    [TARGET_HASH, '/chat/target.db'],
    [SECOND_TARGET_HASH, '/chat/target2.db'],
  ]) {
    stateStore.enable({
      dbPathHash: hash,
      dbPath: dbFile,
      modelId: MODEL,
      chunkerVersion: 'v1.1',
      chunkerConfigHash: 'cfg',
    })
  }
  return { store, stateStore }
}

test('merged session copies source vectors and only embeds the chunks with new messages', async () => {
  const { store, stateStore } = makeCarryOverFixture()

  // 源会话：8 条消息 -> 4 个 chunk，向量全部是 [1,0,0,0]
  const sourceMessages = Array.from({ length: 8 }, (_, i) => mergeMessage(i + 1, i + 1))
  const sourceEmbedder = new ConstantEmbedder([1, 0, 0, 0])
  const sourceResult = await runWarmup({
    dbPathHash: SOURCE_HASH,
    modelId: MODEL,
    embedder: sourceEmbedder,
    store,
    stateStore,
    source: makeSource(sourceMessages),
    config,
  })
  assert.equal(sourceResult.chunksWritten, 4)
  assert.equal(sourceResult.chunksReused, 0)
  assert.equal(sourceEmbedder.calls, 8 / 2)

  // 合并产物：同样的消息（id 全变）+ 尾部两条新消息 -> 5 个 chunk
  const mergedMessages = [
    ...Array.from({ length: 8 }, (_, i) => mergeMessage(i + 1, 1000 + i)),
    ...Array.from({ length: 2 }, (_, i) => mergeMessage(9 + i, 1008 + i)),
  ]
  const targetEmbedder = new ConstantEmbedder([0, 1, 0, 0])
  const result = await runWarmup({
    dbPathHash: TARGET_HASH,
    modelId: MODEL,
    embedder: targetEmbedder,
    store,
    stateStore,
    source: makeSource(mergedMessages),
    config,
  })

  assert.equal(result.status, 'completed')
  assert.equal(result.chunksWritten, 5)
  assert.equal(result.chunksReused, 4)
  // 只有含新消息的那一个 chunk 被 embedding
  assert.equal(targetEmbedder.calls, 1)
  assert.equal(stateStore.getState(TARGET_HASH)!.chunkCount, 5)

  // 复用的 4 个 chunk 拿到的是源向量 [1,0,0,0]，不是本次 embedder 的 [0,1,0,0]
  const copied = store
    .queryDense({ dbPathHash: TARGET_HASH, modelId: MODEL, dim: 4, embedding: [1, 0, 0, 0], k: 10 })
    .filter((hit) => hit.distance === 0)
  assert.equal(copied.length, 4)

  // 续跑：没有新消息就不再写入，也不再复用
  const rerun = await runWarmup({
    dbPathHash: TARGET_HASH,
    modelId: MODEL,
    embedder: targetEmbedder,
    store,
    stateStore,
    source: makeSource(mergedMessages),
    config,
  })
  assert.equal(rerun.chunksWritten, 0)
  assert.equal(rerun.chunksReused, 0)
  assert.equal(targetEmbedder.calls, 1)

  store.close()
  stateStore.close()
})

test('vectors are not reused across models', async () => {
  const { store, stateStore } = makeCarryOverFixture()
  const messages = Array.from({ length: 4 }, (_, i) => mergeMessage(i + 1, i + 1))

  await runWarmup({
    dbPathHash: SOURCE_HASH,
    modelId: MODEL,
    embedder: new ConstantEmbedder([1, 0, 0, 0]),
    store,
    stateStore,
    source: makeSource(messages),
    config,
  })

  const otherModelEmbedder = new ConstantEmbedder([0, 1, 0, 0])
  const result = await runWarmup({
    dbPathHash: TARGET_HASH,
    modelId: 'other-model',
    embedder: otherModelEmbedder,
    store,
    stateStore,
    source: makeSource(messages.map((m) => ({ ...m, id: m.id + 1000 }))),
    config,
  })

  assert.equal(result.chunksReused, 0)
  assert.equal(otherModelEmbedder.calls, 2)

  store.close()
  stateStore.close()
})

test('a merged session with a different title re-embeds instead of copying the source vectors', async () => {
  const { store, stateStore } = makeCarryOverFixture()
  const messages = Array.from({ length: 8 }, (_, i) => mergeMessage(i + 1, i + 1))

  await runWarmup({
    dbPathHash: SOURCE_HASH,
    modelId: MODEL,
    embedder: new ConstantEmbedder([1, 0, 0, 0]),
    store,
    stateStore,
    source: makeTitledSource(messages, '原会话'),
    config,
  })

  // 逐字节相同的消息，只有会话标题不同：标题进 embedding 文本，复用会拿到另一段文本的向量
  const renamed = messages.map((m) => ({ ...m, id: m.id + 1000 }))
  const renamedEmbedder = new ConstantEmbedder([0, 1, 0, 0])
  const renamedResult = await runWarmup({
    dbPathHash: TARGET_HASH,
    modelId: MODEL,
    embedder: renamedEmbedder,
    store,
    stateStore,
    source: makeTitledSource(renamed, '改名后的会话'),
    config,
  })

  assert.equal(renamedResult.chunksWritten, 4)
  assert.equal(renamedResult.chunksReused, 0)
  assert.equal(renamedEmbedder.calls, 4)

  // 同一批消息、同一个标题则整段复用，不再调用 embedder
  const sameTitleEmbedder = new ConstantEmbedder([0, 0, 1, 0])
  const sameTitleResult = await runWarmup({
    dbPathHash: SECOND_TARGET_HASH,
    modelId: MODEL,
    embedder: sameTitleEmbedder,
    store,
    stateStore,
    source: makeTitledSource(renamed, '原会话'),
    config,
  })

  assert.equal(sameTitleResult.chunksWritten, 4)
  assert.equal(sameTitleResult.chunksReused, 4)
  assert.equal(sameTitleEmbedder.calls, 0)

  store.close()
  stateStore.close()
})
