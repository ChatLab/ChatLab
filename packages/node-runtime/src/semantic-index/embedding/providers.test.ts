import assert from 'node:assert/strict'
import test from 'node:test'
import { createProxyFetch, LocalEmbeddingProvider, type LocalPipelineFactory } from './local'
import { OpenAICompatibleEmbeddingProvider, type FetchFn } from './api'
import { QWEN3_PROFILE, type LocalEmbeddingProfile } from './profiles'

// 无 maxBatchSize 的本地 profile，用于验证「不限批量时一次性 embed 全部文本」的分支
const NO_BATCH_PROFILE: LocalEmbeddingProfile = { ...QWEN3_PROFILE, maxBatchSize: undefined, dim: 8 }

// 返回固定 dim 的 fake 抽取器，并记录每次调用的 batch 文本
function makeFakeFactory(dim: number, calls: string[][]): LocalPipelineFactory {
  return async () => async (texts) => {
    calls.push(texts)
    return texts.map((_, i) => Array.from({ length: dim }, (_, j) => (i + j) % 7))
  }
}

test('Qwen3 local provider embeds one text per call (batch=1)', async () => {
  const calls: string[][] = []
  const provider = new LocalEmbeddingProvider(QWEN3_PROFILE, { pipelineFactory: makeFakeFactory(1024, calls) })

  const vectors = await provider.embedDocuments(['a', 'b', 'c'])
  assert.equal(vectors.length, 3)
  assert.equal(vectors[0].length, 1024)
  // batch=1：三条文本应分三次调用，每次一条
  assert.equal(calls.length, 3)
  assert.ok(calls.every((c) => c.length === 1))
})

test('local provider without maxBatchSize embeds all texts in a single call', async () => {
  const calls: string[][] = []
  const provider = new LocalEmbeddingProvider(NO_BATCH_PROFILE, { pipelineFactory: makeFakeFactory(8, calls) })

  const vectors = await provider.embedDocuments(['a', 'b', 'c'])
  assert.equal(vectors.length, 3)
  assert.equal(vectors[0].length, 8)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].length, 3)
})

test('local provider prepends query instruction for embedQuery', async () => {
  const calls: string[][] = []
  const provider = new LocalEmbeddingProvider(QWEN3_PROFILE, { pipelineFactory: makeFakeFactory(1024, calls) })

  await provider.embedQuery('北京天气')
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], `Instruct: ${QWEN3_PROFILE.queryInstruction}\nQuery: 北京天气`)
})

test('local provider clamps document text to maxTextChars', async () => {
  const calls: string[][] = []
  const provider = new LocalEmbeddingProvider(QWEN3_PROFILE, { pipelineFactory: makeFakeFactory(1024, calls) })

  const long = 'x'.repeat(QWEN3_PROFILE.maxTextChars! + 500)
  await provider.embedDocuments([long])
  assert.equal(calls[0][0].length, QWEN3_PROFILE.maxTextChars)
})

test('local provider throws when returned dim mismatches profile', async () => {
  const provider = new LocalEmbeddingProvider(QWEN3_PROFILE, { pipelineFactory: makeFakeFactory(256, []) })
  await assert.rejects(() => provider.embedDocuments(['a']), /dim/i)
})

test('local model download proxy rejects SOCKS URLs explicitly', async () => {
  await assert.rejects(() => createProxyFetch('socks5://127.0.0.1:1080'), /SOCKS proxy is not supported/)
})

test('API provider posts OpenAI-compatible request and parses ordered embeddings', async () => {
  let captured: { url: string; body: string; headers: Record<string, string> } | null = null
  const fetchFn: FetchFn = async (url, init) => {
    captured = { url, body: init.body, headers: init.headers }
    return {
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({
        data: [
          { index: 1, embedding: [0.3, 0.4] },
          { index: 0, embedding: [0.1, 0.2] },
        ],
      }),
    }
  }
  const provider = new OpenAICompatibleEmbeddingProvider(
    { baseUrl: 'https://api.example.com/v1/', apiKey: 'sk-test', model: 'text-embedding-3-small' },
    { fetchFn }
  )

  assert.equal(provider.documentBatchSize, 32)
  const vectors = await provider.embedDocuments(['first', 'second'])
  assert.equal(captured!.url, 'https://api.example.com/v1/embeddings')
  assert.equal(captured!.headers.Authorization, 'Bearer sk-test')
  assert.deepEqual(JSON.parse(captured!.body), { model: 'text-embedding-3-small', input: ['first', 'second'] })
  // 按 index 排序：index 0 在前（Float32 精度，按近似比较）
  const approx = (a: Float32Array, b: number[]) => b.every((v, i) => Math.abs(a[i] - v) < 1e-6)
  assert.ok(approx(vectors[0], [0.1, 0.2]))
  assert.ok(approx(vectors[1], [0.3, 0.4]))
  assert.equal(provider.dim, 2)
})

test('API provider omits Authorization header when API key is empty', async () => {
  let capturedHeaders: Record<string, string> | null = null
  const fetchFn: FetchFn = async (_url, init) => {
    capturedHeaders = init.headers
    return {
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({ data: [{ index: 0, embedding: [0.1, 0.2] }] }),
    }
  }
  const provider = new OpenAICompatibleEmbeddingProvider(
    { baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'nomic-embed-text' },
    { fetchFn }
  )

  await provider.embedDocuments(['hello'])

  assert.equal(capturedHeaders!.Authorization, undefined)
})

test('API provider embedQuery does not add instruction', async () => {
  let capturedInput: unknown = null
  const fetchFn: FetchFn = async (_url, init) => {
    capturedInput = JSON.parse(init.body).input
    return { ok: true, status: 200, text: async () => '', json: async () => ({ data: [{ index: 0, embedding: [1] }] }) }
  }
  const provider = new OpenAICompatibleEmbeddingProvider(
    { baseUrl: 'https://api.example.com', apiKey: 'k', model: 'm' },
    { fetchFn }
  )
  await provider.embedQuery('原始查询')
  assert.deepEqual(capturedInput, ['原始查询'])
})

test('API provider throws on non-ok response', async () => {
  const fetchFn: FetchFn = async () => ({
    ok: false,
    status: 429,
    text: async () => 'rate limited',
    json: async () => ({}),
  })
  const provider = new OpenAICompatibleEmbeddingProvider(
    { baseUrl: 'https://api.example.com', apiKey: 'k', model: 'm' },
    { fetchFn }
  )
  await assert.rejects(() => provider.embedDocuments(['x']), /429/)
})
