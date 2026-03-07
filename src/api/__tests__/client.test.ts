/**
 * Tests for src/api/client.ts — base HTTP client
 *
 * Uses node:test and mocks globalThis.fetch.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { get, post, put, patch, del, upload, postSSE, setBaseUrl, getBaseUrl, ApiError } from '../client'

// ── Helpers ──────────────────────────────────────────────────

function createMockResponse(body: unknown, init?: ResponseInit): Response {
  const json = JSON.stringify(body)
  return new Response(json, {
    status: init?.status ?? 200,
    statusText: init?.statusText ?? 'OK',
    headers: {
      'Content-Type': 'application/json',
      ...((init?.headers as Record<string, string>) ?? {}),
    },
  })
}

function createSSEResponse(lines: string[]): Response {
  const text = lines.join('\n\n') + '\n\n'
  return new Response(text, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

let fetchMock: ReturnType<typeof mock.fn>

// ── Setup / Teardown ─────────────────────────────────────────

beforeEach(() => {
  fetchMock = mock.fn()
  ;(globalThis as unknown as { fetch: unknown }).fetch = fetchMock
  setBaseUrl('/api')
})

afterEach(() => {
  delete (globalThis as unknown as { fetch?: unknown }).fetch
})

// ── Tests ────────────────────────────────────────────────────

describe('setBaseUrl / getBaseUrl', () => {
  it('should set and return the base URL', () => {
    setBaseUrl('http://localhost:3001/api/')
    assert.equal(getBaseUrl(), 'http://localhost:3001/api')
  })

  it('should strip trailing slashes', () => {
    setBaseUrl('/api///')
    assert.equal(getBaseUrl(), '/api')
  })
})

describe('get()', () => {
  it('should make a GET request and parse JSON response', async () => {
    const data = { status: 'ok' }
    fetchMock.mock.mockImplementation(() => Promise.resolve(createMockResponse(data)))

    const result = await get('/health')

    assert.deepEqual(result, data)
    assert.equal(fetchMock.mock.callCount(), 1)
    const [url] = fetchMock.mock.calls[0].arguments
    assert.equal(url, '/api/health')
  })

  it('should append query parameters', async () => {
    fetchMock.mock.mockImplementation(() => Promise.resolve(createMockResponse([])))

    await get('/sessions', { startTs: 100, endTs: 200, missing: undefined })

    const [url] = fetchMock.mock.calls[0].arguments
    assert.ok(url.includes('startTs=100'))
    assert.ok(url.includes('endTs=200'))
    assert.ok(!url.includes('missing'))
  })

  it('should throw ApiError on non-OK response', async () => {
    fetchMock.mock.mockImplementation(() =>
      Promise.resolve(createMockResponse({ error: 'not found' }, { status: 404, statusText: 'Not Found' })),
    )

    await assert.rejects(() => get('/missing'), (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal((err as ApiError).status, 404)
      assert.equal((err as ApiError).message, 'not found')
      return true
    })
  })
})

describe('post()', () => {
  it('should make a POST request with JSON body', async () => {
    const body = { sql: 'SELECT 1' }
    fetchMock.mock.mockImplementation(() => Promise.resolve(createMockResponse({ rows: [] })))

    await post('/sessions/s1/sql', body)

    assert.equal(fetchMock.mock.callCount(), 1)
    const [url, options] = fetchMock.mock.calls[0].arguments
    assert.equal(url, '/api/sessions/s1/sql')
    assert.equal(options.method, 'POST')
    assert.equal(options.headers['Content-Type'], 'application/json')
    assert.equal(options.body, JSON.stringify(body))
  })
})

describe('put()', () => {
  it('should make a PUT request', async () => {
    fetchMock.mock.mockImplementation(() => Promise.resolve(createMockResponse({ success: true })))

    await put('/llm/configs/abc/activate')

    const [, options] = fetchMock.mock.calls[0].arguments
    assert.equal(options.method, 'PUT')
  })
})

describe('patch()', () => {
  it('should make a PATCH request', async () => {
    fetchMock.mock.mockImplementation(() => Promise.resolve(createMockResponse(true)))

    await patch('/sessions/s1', { name: 'renamed' })

    const [, options] = fetchMock.mock.calls[0].arguments
    assert.equal(options.method, 'PATCH')
  })
})

describe('del()', () => {
  it('should make a DELETE request', async () => {
    fetchMock.mock.mockImplementation(() => Promise.resolve(createMockResponse(true)))

    await del('/sessions/s1')

    const [, options] = fetchMock.mock.calls[0].arguments
    assert.equal(options.method, 'DELETE')
  })
})

describe('upload()', () => {
  it('should make a POST request with FormData', async () => {
    fetchMock.mock.mockImplementation(() =>
      Promise.resolve(createMockResponse({ success: true, sessionId: 's1' })),
    )

    const fd = new FormData()
    fd.append('file', new Blob(['test']), 'test.txt')

    const result = await upload<{ success: boolean; sessionId: string }>('/import', fd)

    assert.equal(result.success, true)
    assert.equal(result.sessionId, 's1')
    const [, options] = fetchMock.mock.calls[0].arguments
    assert.equal(options.method, 'POST')
    assert.ok(options.body instanceof FormData)
  })
})

describe('postSSE()', () => {
  it('should parse SSE data lines and call onChunk', async () => {
    const chunks = [
      { type: 'content', content: 'Hello' },
      { type: 'content', content: ' world' },
      { type: 'done', isFinished: true },
    ]
    const sseLines = chunks.map((c) => `data: ${JSON.stringify(c)}`)

    fetchMock.mock.mockImplementation(() => Promise.resolve(createSSEResponse(sseLines)))

    const received: unknown[] = []
    await postSSE('/agent/run', { message: 'hi' }, {
      onChunk: (chunk: unknown) => received.push(chunk),
    })

    assert.equal(received.length, 3)
    assert.deepEqual(received[0], { type: 'content', content: 'Hello' })
    assert.deepEqual(received[2], { type: 'done', isFinished: true })
  })

  it('should throw ApiError on non-OK response', async () => {
    fetchMock.mock.mockImplementation(() =>
      Promise.resolve(createMockResponse({ error: 'bad' }, { status: 400, statusText: 'Bad Request' })),
    )

    await assert.rejects(
      () => postSSE('/agent/run', {}, { onChunk: () => {} }),
      (err: unknown) => {
        assert.ok(err instanceof ApiError)
        assert.equal((err as ApiError).status, 400)
        return true
      },
    )
  })
})
