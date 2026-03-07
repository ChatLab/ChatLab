/**
 * Tests for domain-specific API modules.
 *
 * Verifies that each module correctly maps to the expected HTTP endpoints
 * by intercepting fetch calls and checking method, URL, and body.
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

// ==================== Test infrastructure ====================

interface CapturedRequest {
  url: string
  method: string
  body?: unknown
  headers?: Record<string, string>
}

let lastRequest: CapturedRequest | null = null
let mockResponse: { status: number; body: unknown } = { status: 200, body: {} }
const originalFetch = globalThis.fetch

function setupMocks() {
  ;(globalThis as any).window = {
    location: { origin: 'http://localhost:3400' },
  }

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method || 'GET'
    let body: unknown
    if (init?.body && typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body)
      } catch {
        body = init.body
      }
    }
    lastRequest = {
      url,
      method,
      body,
      headers: init?.headers as Record<string, string>,
    }

    return {
      ok: mockResponse.status >= 200 && mockResponse.status < 300,
      status: mockResponse.status,
      headers: { get: () => 'application/json' },
      json: async () => mockResponse.body,
      text: async () => JSON.stringify(mockResponse.body),
    } as unknown as Response
  }) as typeof globalThis.fetch
}

function teardownMocks() {
  delete (globalThis as any).window
  globalThis.fetch = originalFetch
  lastRequest = null
  mockResponse = { status: 200, body: {} }
}

// ==================== Tests ====================

describe('chatApi', () => {
  beforeEach(setupMocks)
  afterEach(teardownMocks)

  it('getSessions fetches GET /api/sessions', async () => {
    mockResponse = { status: 200, body: [{ id: '1', name: 'Test' }] }

    const { chatApi } = await import('./chat.js')
    const { setBaseUrl } = await import('./client.js')
    setBaseUrl('/api')

    const sessions = await chatApi.getSessions()
    assert.ok(Array.isArray(sessions))
    assert.equal(lastRequest?.method, 'GET')
    assert.ok(lastRequest?.url.includes('/api/sessions'))
  })

  it('deleteSession sends DELETE /api/sessions/:id', async () => {
    mockResponse = { status: 200, body: { success: true } }

    const { chatApi } = await import('./chat.js')
    const { setBaseUrl } = await import('./client.js')
    setBaseUrl('/api')

    const result = await chatApi.deleteSession('abc123')
    assert.equal(result, true)
    assert.equal(lastRequest?.method, 'DELETE')
    assert.ok(lastRequest?.url.includes('/api/sessions/abc123'))
  })

  it('renameSession sends PATCH /api/sessions/:id', async () => {
    mockResponse = { status: 200, body: { success: true } }

    const { chatApi } = await import('./chat.js')
    const { setBaseUrl } = await import('./client.js')
    setBaseUrl('/api')

    const result = await chatApi.renameSession('abc123', 'New Name')
    assert.equal(result, true)
    assert.equal(lastRequest?.method, 'PATCH')
    assert.ok(lastRequest?.url.includes('/api/sessions/abc123'))
    assert.deepEqual(lastRequest?.body, { name: 'New Name' })
  })

  it('executeSQL sends POST /api/sessions/:id/sql', async () => {
    mockResponse = {
      status: 200,
      body: { columns: ['count'], rows: [[42]], rowCount: 1, duration: 5, limited: false },
    }

    const { chatApi } = await import('./chat.js')
    const { setBaseUrl } = await import('./client.js')
    setBaseUrl('/api')

    const result = await chatApi.executeSQL('abc123', 'SELECT count(*) FROM message')
    assert.equal(result.rowCount, 1)
    assert.equal(lastRequest?.method, 'POST')
    assert.deepEqual(lastRequest?.body, { sql: 'SELECT count(*) FROM message' })
  })
})

describe('aiApi', () => {
  beforeEach(setupMocks)
  afterEach(teardownMocks)

  it('searchMessages sends POST /api/sessions/:id/messages/search', async () => {
    mockResponse = { status: 200, body: { messages: [], total: 0 } }

    const { aiApi } = await import('./ai.js')
    const { setBaseUrl } = await import('./client.js')
    setBaseUrl('/api')

    await aiApi.searchMessages('s1', ['hello'], { startTs: 100 })
    assert.equal(lastRequest?.method, 'POST')
    assert.ok(lastRequest?.url.includes('/api/sessions/s1/messages/search'))
    // JSON.parse strips undefined values, so only defined keys remain
    const body = lastRequest?.body as Record<string, unknown>
    assert.deepEqual(body.keywords, ['hello'])
    assert.deepEqual(body.filter, { startTs: 100 })
  })

  it('createConversation sends POST /api/ai-conversations/:sessionId', async () => {
    mockResponse = { status: 200, body: { id: 'conv1', sessionId: 's1', title: 'T', createdAt: 0, updatedAt: 0 } }

    const { aiApi } = await import('./ai.js')
    const { setBaseUrl } = await import('./client.js')
    setBaseUrl('/api')

    const conv = await aiApi.createConversation('s1', 'My title')
    assert.equal(conv.id, 'conv1')
    assert.equal(lastRequest?.method, 'POST')
    assert.ok(lastRequest?.url.includes('/api/ai-conversations/s1'))
  })

  it('deleteConversation sends DELETE', async () => {
    mockResponse = { status: 200, body: { success: true } }

    const { aiApi } = await import('./ai.js')
    const { setBaseUrl } = await import('./client.js')
    setBaseUrl('/api')

    const result = await aiApi.deleteConversation('conv1')
    assert.equal(result, true)
    assert.equal(lastRequest?.method, 'DELETE')
    assert.ok(lastRequest?.url.includes('/api/ai-conversations/conv1'))
  })
})

describe('llmApi', () => {
  beforeEach(setupMocks)
  afterEach(teardownMocks)

  it('getProviders fetches GET /api/llm/providers', async () => {
    mockResponse = { status: 200, body: [{ id: 'deepseek', name: 'DeepSeek' }] }

    const { llmApi } = await import('./llm.js')
    const { setBaseUrl } = await import('./client.js')
    setBaseUrl('/api')

    const providers = await llmApi.getProviders()
    assert.ok(Array.isArray(providers))
    assert.equal(lastRequest?.method, 'GET')
  })

  it('hasConfig fetches GET /api/llm/has-config', async () => {
    mockResponse = { status: 200, body: { hasConfig: true } }

    const { llmApi } = await import('./llm.js')
    const { setBaseUrl } = await import('./client.js')
    setBaseUrl('/api')

    const result = await llmApi.hasConfig()
    assert.equal(result, true)
  })

  it('addConfig sends POST /api/llm/configs', async () => {
    mockResponse = { status: 201, body: { id: 'c1', name: 'My Config' } }

    const { llmApi } = await import('./llm.js')
    const { setBaseUrl } = await import('./client.js')
    setBaseUrl('/api')

    const result = await llmApi.addConfig({
      name: 'My Config',
      provider: 'deepseek',
      apiKey: 'sk-test',
    })
    assert.equal(result.success, true)
    assert.equal(lastRequest?.method, 'POST')
  })
})

describe('embeddingApi', () => {
  beforeEach(setupMocks)
  afterEach(teardownMocks)

  it('getAllConfigs fetches GET /api/embedding/configs', async () => {
    mockResponse = { status: 200, body: { configs: [{ id: 'e1' }], activeConfigId: 'e1' } }

    const { embeddingApi } = await import('./embedding.js')
    const { setBaseUrl } = await import('./client.js')
    setBaseUrl('/api')

    const configs = await embeddingApi.getAllConfigs()
    assert.ok(Array.isArray(configs))
    assert.equal(configs[0].id, 'e1')
  })
})

describe('nlpApi', () => {
  beforeEach(setupMocks)
  afterEach(teardownMocks)

  it('getPosTags fetches GET /api/nlp/pos-tags', async () => {
    mockResponse = { status: 200, body: [{ tag: 'n', name: 'noun' }] }

    const { nlpApi } = await import('./nlp.js')
    const { setBaseUrl } = await import('./client.js')
    setBaseUrl('/api')

    const tags = await nlpApi.getPosTags()
    assert.ok(Array.isArray(tags))
    assert.equal(lastRequest?.method, 'GET')
    assert.ok(lastRequest?.url.includes('/api/nlp/pos-tags'))
  })

  it('getWordFrequency sends POST', async () => {
    mockResponse = { status: 200, body: { words: [], totalWords: 0, totalMessages: 0, uniqueWords: 0 } }

    const { nlpApi } = await import('./nlp.js')
    const { setBaseUrl } = await import('./client.js')
    setBaseUrl('/api')

    await nlpApi.getWordFrequency({ sessionId: 's1', locale: 'zh-CN' })
    assert.equal(lastRequest?.method, 'POST')
    assert.ok(lastRequest?.url.includes('/api/sessions/s1/nlp/word-frequency'))
  })
})

describe('networkApi', () => {
  beforeEach(setupMocks)
  afterEach(teardownMocks)

  it('getProxyConfig fetches GET /api/network/proxy', async () => {
    mockResponse = { status: 200, body: { mode: 'off', url: '' } }

    const { networkApi } = await import('./network.js')
    const { setBaseUrl } = await import('./client.js')
    setBaseUrl('/api')

    const config = await networkApi.getProxyConfig()
    assert.equal(config.mode, 'off')
    assert.equal(lastRequest?.method, 'GET')
  })

  it('saveProxyConfig sends PUT /api/network/proxy', async () => {
    mockResponse = { status: 200, body: { success: true } }

    const { networkApi } = await import('./network.js')
    const { setBaseUrl } = await import('./client.js')
    setBaseUrl('/api')

    await networkApi.saveProxyConfig({ mode: 'manual', url: 'http://proxy:8080' })
    assert.equal(lastRequest?.method, 'PUT')
    assert.deepEqual(lastRequest?.body, { mode: 'manual', url: 'http://proxy:8080' })
  })
})

describe('cacheApi', () => {
  beforeEach(setupMocks)
  afterEach(teardownMocks)

  it('getInfo fetches GET /api/cache/info', async () => {
    mockResponse = { status: 200, body: { baseDir: '/data', directories: [], totalSize: 0 } }

    const { cacheApi } = await import('./cache.js')
    const { setBaseUrl } = await import('./client.js')
    setBaseUrl('/api')

    const info = await cacheApi.getInfo()
    assert.equal(info.baseDir, '/data')
    assert.equal(lastRequest?.method, 'GET')
  })

  it('openDir returns unsupported in web mode', async () => {
    const { cacheApi } = await import('./cache.js')
    const result = await cacheApi.openDir('temp')
    assert.equal(result.success, false)
    assert.ok(result.error?.includes('Not supported'))
  })
})

describe('sessionApi', () => {
  beforeEach(setupMocks)
  afterEach(teardownMocks)

  it('generate sends POST and returns count', async () => {
    mockResponse = { status: 200, body: { success: true, sessionCount: 42 } }

    const { sessionApi } = await import('./session-index.js')
    const { setBaseUrl } = await import('./client.js')
    setBaseUrl('/api')

    const count = await sessionApi.generate('s1', 1800)
    assert.equal(count, 42)
    assert.equal(lastRequest?.method, 'POST')
    assert.ok(lastRequest?.url.includes('/api/sessions/s1/session-index/generate'))
  })

  it('hasIndex returns boolean', async () => {
    mockResponse = { status: 200, body: { hasIndex: true } }

    const { sessionApi } = await import('./session-index.js')
    const { setBaseUrl } = await import('./client.js')
    setBaseUrl('/api')

    const result = await sessionApi.hasIndex('s1')
    assert.equal(result, true)
  })
})

describe('mergeApi', () => {
  beforeEach(setupMocks)
  afterEach(teardownMocks)

  it('checkConflicts sends POST /api/merge/check-conflicts', async () => {
    mockResponse = { status: 200, body: { hasConflicts: false, conflicts: [] } }

    const { mergeApi } = await import('./merge.js')
    const { setBaseUrl } = await import('./client.js')
    setBaseUrl('/api')

    await mergeApi.checkConflicts(['key1', 'key2'])
    assert.equal(lastRequest?.method, 'POST')
    assert.ok(lastRequest?.url.includes('/api/merge/check-conflicts'))
    assert.deepEqual(lastRequest?.body, { fileKeys: ['key1', 'key2'] })
  })

  it('clearCache sends POST /api/merge/clear-cache', async () => {
    mockResponse = { status: 200, body: { success: true } }

    const { mergeApi } = await import('./merge.js')
    const { setBaseUrl } = await import('./client.js')
    setBaseUrl('/api')

    const result = await mergeApi.clearCache('key1')
    assert.equal(result, true)
    assert.equal(lastRequest?.method, 'POST')
  })
})

describe('migrationApi', () => {
  beforeEach(setupMocks)
  afterEach(teardownMocks)

  it('checkMigration fetches GET /api/migration/check', async () => {
    mockResponse = {
      status: 200,
      body: { needsMigration: false, count: 0, currentVersion: 1, pendingMigrations: [] },
    }

    const { migrationApi } = await import('./merge.js')
    const { setBaseUrl } = await import('./client.js')
    setBaseUrl('/api')

    const result = await migrationApi.checkMigration()
    assert.equal(result.needsMigration, false)
    assert.equal(lastRequest?.method, 'GET')
  })
})

describe('index re-exports', () => {
  beforeEach(setupMocks)
  afterEach(teardownMocks)

  it('exports all API modules from index', async () => {
    const api = await import('./index.js')

    assert.ok(api.chatApi, 'chatApi should be exported')
    assert.ok(api.aiApi, 'aiApi should be exported')
    assert.ok(api.llmApi, 'llmApi should be exported')
    assert.ok(api.agentApi, 'agentApi should be exported')
    assert.ok(api.embeddingApi, 'embeddingApi should be exported')
    assert.ok(api.nlpApi, 'nlpApi should be exported')
    assert.ok(api.networkApi, 'networkApi should be exported')
    assert.ok(api.cacheApi, 'cacheApi should be exported')
    assert.ok(api.sessionApi, 'sessionApi should be exported')
    assert.ok(api.mergeApi, 'mergeApi should be exported')
    assert.ok(api.migrationApi, 'migrationApi should be exported')
    assert.ok(api.setBaseUrl, 'setBaseUrl should be exported')
    assert.ok(api.getBaseUrl, 'getBaseUrl should be exported')
    assert.ok(api.ApiError, 'ApiError should be exported')
  })
})
