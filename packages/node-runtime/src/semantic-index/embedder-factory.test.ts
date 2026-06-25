import assert from 'node:assert/strict'
import test from 'node:test'
import { createEmbedder } from './embedder-factory'
import { QWEN3_PROFILE } from './embedding/profiles'
import type { SemanticIndexConfig } from './config'
import type { FetchFn } from './embedding/api'
import type { LocalPipelineFactory } from './embedding/local'

const localConfig: SemanticIndexConfig = {
  version: 1,
  enabled: true,
  mode: 'local',
  local: { modelId: QWEN3_PROFILE.modelId },
  api: null,
  searchMaxResults: 5,
}

test('builds local provider from profile with injected pipeline factory', async () => {
  let seenProxyUrl: string | undefined
  const fakeFactory: LocalPipelineFactory = async () => async (texts) =>
    texts.map(() => new Array(QWEN3_PROFILE.dim).fill(0.1))
  const fakeFactoryWithCapture: LocalPipelineFactory = async (params) => {
    seenProxyUrl = params.modelDownloadProxyUrl
    return fakeFactory(params)
  }
  const embedder = createEmbedder(localConfig, {
    localPipelineFactory: fakeFactoryWithCapture,
    modelDownloadProxyUrl: 'http://127.0.0.1:7890',
  })
  assert.equal(embedder.modelId, QWEN3_PROFILE.modelId)
  assert.equal(embedder.dim, QWEN3_PROFILE.dim)
  const [vector] = await embedder.embedDocuments(['hello'])
  assert.equal(vector.length, QWEN3_PROFILE.dim)
  assert.equal(seenProxyUrl, 'http://127.0.0.1:7890')
})

test('throws for unknown local model', () => {
  const config: SemanticIndexConfig = { ...localConfig, local: { modelId: 'does-not-exist' } }
  assert.throws(() => createEmbedder(config), /unknown local embedding model/)
})

test('builds api provider and resolves key via authProfile', async () => {
  const config: SemanticIndexConfig = {
    version: 1,
    enabled: true,
    mode: 'api',
    local: { modelId: 'x' },
    api: { baseUrl: 'https://api.example.com/v1', model: 'embed-1', authProfile: 'profileA' },
    searchMaxResults: 5,
  }

  let usedKey = ''
  const fetchFn: FetchFn = async (_url, init) => {
    const headers = init.headers as Record<string, string>
    usedKey = headers.Authorization
    return {
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({ data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }] }),
    }
  }

  const embedder = createEmbedder(config, {
    resolveApiKey: (_provider, authProfile) => (authProfile === 'profileA' ? 'secret-key' : ''),
    fetchFn,
  })
  const [vector] = await embedder.embedDocuments(['hi'])
  assert.equal(vector.length, 3)
  assert.equal(usedKey, 'Bearer secret-key')
})

test('throws when api config incomplete', () => {
  const config: SemanticIndexConfig = {
    version: 1,
    enabled: true,
    mode: 'api',
    local: { modelId: 'x' },
    api: { baseUrl: '', model: '' },
    searchMaxResults: 5,
  }
  assert.throws(() => createEmbedder(config), /API config incomplete/)
})
