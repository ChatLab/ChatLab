/**
 * Tests for domain-specific API modules (chat, ai, llm, agent, etc.)
 *
 * Verifies that each module calls the correct HTTP endpoint with the right
 * method and payload. Uses node:test with a mocked globalThis.fetch.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { setBaseUrl } from '../client'

// ── Mock fetch setup ─────────────────────────────────────────

function createMockResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { 'Content-Type': 'application/json' },
  })
}

let fetchMock: ReturnType<typeof mock.fn>
let lastUrl: string
let lastInit: RequestInit | undefined

beforeEach(() => {
  setBaseUrl('/api')
  fetchMock = mock.fn((...args: unknown[]) => {
    lastUrl = args[0] as string
    lastInit = args[1] as RequestInit | undefined
    return Promise.resolve(createMockResponse({ _default: true }))
  })
  ;(globalThis as unknown as { fetch: unknown }).fetch = fetchMock
})

afterEach(() => {
  delete (globalThis as unknown as { fetch?: unknown }).fetch
})

// Helper to set a specific response for the next call
function respondWith(body: unknown, status = 200) {
  fetchMock.mock.mockImplementation((...args: unknown[]) => {
    lastUrl = args[0] as string
    lastInit = args[1] as RequestInit | undefined
    return Promise.resolve(createMockResponse(body, status))
  })
}

// ── chatApi ──────────────────────────────────────────────────

describe('chatApi', () => {
  it('getSessions should GET /api/sessions', async () => {
    respondWith([])
    // Dynamic import to pick up the mocked fetch
    const { chatApi } = await import('../chat')
    await chatApi.getSessions()
    assert.equal(lastUrl, '/api/sessions')
    assert.equal(lastInit, undefined) // GET has no init
  })

  it('getSession should GET /api/sessions/:id', async () => {
    respondWith({ id: 's1' })
    const { chatApi } = await import('../chat')
    await chatApi.getSession('s1')
    assert.equal(lastUrl, '/api/sessions/s1')
  })

  it('deleteSession should DELETE /api/sessions/:id', async () => {
    respondWith({ success: true })
    const { chatApi } = await import('../chat')
    const result = await chatApi.deleteSession('s1')
    assert.equal(result, true)
    assert.equal(lastUrl, '/api/sessions/s1')
    assert.equal(lastInit?.method, 'DELETE')
  })

  it('renameSession should PATCH /api/sessions/:id', async () => {
    respondWith({ success: true })
    const { chatApi } = await import('../chat')
    const result = await chatApi.renameSession('s1', 'New Name')
    assert.equal(result, true)
    assert.equal(lastUrl, '/api/sessions/s1')
    assert.equal(lastInit?.method, 'PATCH')
    const body = JSON.parse(lastInit?.body as string)
    assert.equal(body.name, 'New Name')
  })

  it('getMemberActivity should GET with filter params', async () => {
    respondWith([])
    const { chatApi } = await import('../chat')
    await chatApi.getMemberActivity('s1', { startTs: 100, endTs: 200 })
    assert.ok(lastUrl.includes('/api/sessions/s1/member-activity'))
    assert.ok(lastUrl.includes('startTs=100'))
    assert.ok(lastUrl.includes('endTs=200'))
  })

  it('executeSQL should POST to /api/sessions/:id/sql', async () => {
    respondWith({ columns: [], rows: [], rowCount: 0, duration: 1, limited: false })
    const { chatApi } = await import('../chat')
    await chatApi.executeSQL('s1', 'SELECT 1')
    assert.equal(lastUrl, '/api/sessions/s1/sql')
    assert.equal(lastInit?.method, 'POST')
  })

  it('checkMigration should GET /api/migration/check', async () => {
    respondWith({ needsMigration: false, count: 0, currentVersion: 1, pendingMigrations: [] })
    const { chatApi } = await import('../chat')
    await chatApi.checkMigration()
    assert.equal(lastUrl, '/api/migration/check')
  })
})

// ── aiApi ────────────────────────────────────────────────────

describe('aiApi', () => {
  it('searchMessages should POST to /api/sessions/:id/messages/search', async () => {
    respondWith({ messages: [], total: 0 })
    const { aiApi } = await import('../ai')
    await aiApi.searchMessages('s1', ['hello'], { startTs: 100 })
    assert.equal(lastUrl, '/api/sessions/s1/messages/search')
    assert.equal(lastInit?.method, 'POST')
    const body = JSON.parse(lastInit?.body as string)
    assert.deepEqual(body.keywords, ['hello'])
  })

  it('createConversation should POST to /api/ai-conversations/:sessionId', async () => {
    respondWith({ id: 'c1', sessionId: 's1', title: null, createdAt: 0, updatedAt: 0 })
    const { aiApi } = await import('../ai')
    await aiApi.createConversation('s1', 'Test')
    assert.equal(lastUrl, '/api/ai-conversations/s1')
    assert.equal(lastInit?.method, 'POST')
  })

  it('getMessages should GET /api/ai-conversations/:id/messages', async () => {
    respondWith([])
    const { aiApi } = await import('../ai')
    await aiApi.getMessages('c1')
    assert.equal(lastUrl, '/api/ai-conversations/c1/messages')
  })

  it('deleteMessage should DELETE /api/ai-conversations/messages/:id', async () => {
    respondWith({ success: true })
    const { aiApi } = await import('../ai')
    const result = await aiApi.deleteMessage('m1')
    assert.equal(result, true)
    assert.equal(lastUrl, '/api/ai-conversations/messages/m1')
    assert.equal(lastInit?.method, 'DELETE')
  })

  it('filterMessagesWithContext should POST', async () => {
    respondWith({ blocks: [], stats: {}, pagination: {} })
    const { aiApi } = await import('../ai')
    await aiApi.filterMessagesWithContext('s1', ['test'], { startTs: 0, endTs: 100 })
    assert.equal(lastUrl, '/api/sessions/s1/messages/filter')
    assert.equal(lastInit?.method, 'POST')
  })
})

// ── llmApi ───────────────────────────────────────────────────

describe('llmApi', () => {
  it('getProviders should GET /api/llm/providers', async () => {
    respondWith([])
    const { llmApi } = await import('../llm')
    await llmApi.getProviders()
    assert.equal(lastUrl, '/api/llm/providers')
  })

  it('getAllConfigs should GET /api/llm/configs and extract configs', async () => {
    respondWith({ configs: [{ id: 'c1' }], activeConfigId: 'c1' })
    const { llmApi } = await import('../llm')
    const result = await llmApi.getAllConfigs()
    assert.deepEqual(result, [{ id: 'c1' }])
  })

  it('hasConfig should GET /api/llm/has-config and extract boolean', async () => {
    respondWith({ hasConfig: true })
    const { llmApi } = await import('../llm')
    const result = await llmApi.hasConfig()
    assert.equal(result, true)
  })

  it('setActiveConfig should PUT /api/llm/configs/:id/activate', async () => {
    respondWith({ success: true })
    const { llmApi } = await import('../llm')
    await llmApi.setActiveConfig('c1')
    assert.equal(lastUrl, '/api/llm/configs/c1/activate')
    assert.equal(lastInit?.method, 'PUT')
  })

  it('chat should POST to /api/llm/chat', async () => {
    respondWith({ success: true, content: 'hi' })
    const { llmApi } = await import('../llm')
    const result = await llmApi.chat([{ role: 'user', content: 'hello' }])
    assert.equal(result.success, true)
    assert.equal(result.content, 'hi')
  })
})

// ── embeddingApi ─────────────────────────────────────────────

describe('embeddingApi', () => {
  it('getAllConfigs should GET /api/embedding/configs', async () => {
    respondWith([])
    const { embeddingApi } = await import('../embedding')
    await embeddingApi.getAllConfigs()
    assert.equal(lastUrl, '/api/embedding/configs')
  })

  it('deleteConfig should DELETE /api/embedding/configs/:id', async () => {
    respondWith({ success: true })
    const { embeddingApi } = await import('../embedding')
    await embeddingApi.deleteConfig('e1')
    assert.equal(lastUrl, '/api/embedding/configs/e1')
    assert.equal(lastInit?.method, 'DELETE')
  })

  it('getVectorStoreStats should GET /api/embedding/vector-store/stats', async () => {
    respondWith({ enabled: true, count: 42 })
    const { embeddingApi } = await import('../embedding')
    await embeddingApi.getVectorStoreStats()
    assert.equal(lastUrl, '/api/embedding/vector-store/stats')
  })
})

// ── nlpApi ───────────────────────────────────────────────────

describe('nlpApi', () => {
  it('getWordFrequency should POST to /api/sessions/:id/nlp/word-frequency', async () => {
    respondWith({ words: [], totalWords: 0, totalMessages: 0, uniqueWords: 0 })
    const { nlpApi } = await import('../nlp')
    await nlpApi.getWordFrequency({ sessionId: 's1', locale: 'zh-CN' })
    assert.equal(lastUrl, '/api/sessions/s1/nlp/word-frequency')
    assert.equal(lastInit?.method, 'POST')
  })

  it('getPosTags should GET /api/nlp/pos-tags', async () => {
    respondWith([])
    const { nlpApi } = await import('../nlp')
    await nlpApi.getPosTags()
    assert.equal(lastUrl, '/api/nlp/pos-tags')
  })
})

// ── networkApi ───────────────────────────────────────────────

describe('networkApi', () => {
  it('getProxyConfig should GET /api/network/proxy', async () => {
    respondWith({ mode: 'off', url: '' })
    const { networkApi } = await import('../network')
    await networkApi.getProxyConfig()
    assert.equal(lastUrl, '/api/network/proxy')
  })

  it('saveProxyConfig should PUT /api/network/proxy', async () => {
    respondWith({ success: true })
    const { networkApi } = await import('../network')
    await networkApi.saveProxyConfig({ mode: 'manual', url: 'http://proxy:8080' })
    assert.equal(lastUrl, '/api/network/proxy')
    assert.equal(lastInit?.method, 'PUT')
  })
})

// ── cacheApi ─────────────────────────────────────────────────

describe('cacheApi', () => {
  it('getInfo should GET /api/cache/info', async () => {
    respondWith({ baseDir: '/data', directories: [], totalSize: 0 })
    const { cacheApi } = await import('../cache')
    await cacheApi.getInfo()
    assert.equal(lastUrl, '/api/cache/info')
  })

  it('clear should DELETE /api/cache/clear/:id', async () => {
    respondWith({ success: true })
    const { cacheApi } = await import('../cache')
    await cacheApi.clear('temp')
    assert.equal(lastUrl, '/api/cache/clear/temp')
    assert.equal(lastInit?.method, 'DELETE')
  })

  it('openDir should return not supported error', async () => {
    const { cacheApi } = await import('../cache')
    const result = await cacheApi.openDir('temp')
    assert.equal(result.success, false)
    assert.ok(result.error?.includes('Not supported'))
  })
})

// ── sessionApi ───────────────────────────────────────────────

describe('sessionApi', () => {
  it('generate should POST to /api/sessions/:id/session-index/generate', async () => {
    respondWith({ success: true, sessionCount: 5 })
    const { sessionApi } = await import('../session-index')
    const count = await sessionApi.generate('s1', 300)
    assert.equal(count, 5)
    assert.equal(lastUrl, '/api/sessions/s1/session-index/generate')
    assert.equal(lastInit?.method, 'POST')
  })

  it('hasIndex should GET and extract boolean', async () => {
    respondWith({ hasIndex: true })
    const { sessionApi } = await import('../session-index')
    const result = await sessionApi.hasIndex('s1')
    assert.equal(result, true)
  })

  it('getSessions should GET /api/sessions/:id/session-index/sessions', async () => {
    respondWith([])
    const { sessionApi } = await import('../session-index')
    await sessionApi.getSessions('s1')
    assert.equal(lastUrl, '/api/sessions/s1/session-index/sessions')
  })
})

// ── mergeApi ─────────────────────────────────────────────────

describe('mergeApi', () => {
  it('checkConflicts should POST to /api/merge/check-conflicts', async () => {
    respondWith({ hasConflicts: false })
    const { mergeApi } = await import('../merge')
    await mergeApi.checkConflicts(['key1', 'key2'])
    assert.equal(lastUrl, '/api/merge/check-conflicts')
    assert.equal(lastInit?.method, 'POST')
    const body = JSON.parse(lastInit?.body as string)
    assert.deepEqual(body.fileKeys, ['key1', 'key2'])
  })

  it('clearCache should POST to /api/merge/clear-cache', async () => {
    respondWith({ success: true })
    const { mergeApi } = await import('../merge')
    const result = await mergeApi.clearCache('key1')
    assert.equal(result, true)
    assert.equal(lastUrl, '/api/merge/clear-cache')
    assert.equal(lastInit?.method, 'POST')
  })
})

// ── agentApi ─────────────────────────────────────────────────

describe('agentApi', () => {
  it('abort should POST to /api/agent/abort/:requestId', async () => {
    respondWith({ success: true })
    const { agentApi } = await import('../agent')
    const result = await agentApi.abort('req_123')
    assert.equal(lastUrl, '/api/agent/abort/req_123')
    assert.equal(lastInit?.method, 'POST')
    assert.equal(result.success, true)
  })

  it('runStream should return requestId and promise', async () => {
    // Create SSE response for the stream
    const chunks = [
      `data: ${JSON.stringify({ type: 'meta', requestId: 'server_123' })}`,
      `data: ${JSON.stringify({ type: 'content', content: 'Hello' })}`,
      `data: ${JSON.stringify({ type: 'done', content: 'Hello', isFinished: true })}`,
    ]
    const sseText = chunks.join('\n\n') + '\n\n'
    fetchMock.mock.mockImplementation(() =>
      Promise.resolve(
        new Response(sseText, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    )

    const { agentApi } = await import('../agent')
    const received: unknown[] = []
    const { requestId, promise } = agentApi.runStream(
      'Hello',
      { sessionId: 's1' },
      (chunk) => received.push(chunk),
    )

    assert.ok(requestId.startsWith('agent_'))
    const result = await promise
    assert.equal(result.success, true)
    assert.ok(received.length >= 2) // meta + content + done
  })
})
