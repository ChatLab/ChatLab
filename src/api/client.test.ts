/**
 * Tests for the base HTTP client (src/api/client.ts)
 *
 * We mock globalThis.fetch to test the client's request handling,
 * error parsing, and SSE streaming logic.
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

// We need to set up a minimal DOM-like environment for the client module.
// The client uses `window.location.origin` in buildUrl — we mock it.
const originalWindow = globalThis.window
const originalFetch = globalThis.fetch

function setupGlobals() {
  ;(globalThis as any).window = {
    location: { origin: 'http://localhost:3400' },
  }
}

function teardownGlobals() {
  if (originalWindow) {
    ;(globalThis as any).window = originalWindow
  } else {
    delete (globalThis as any).window
  }
  globalThis.fetch = originalFetch
}

// Helper to create a mock fetch response
function mockFetch(
  status: number,
  body: unknown,
  headers?: Record<string, string>,
): typeof globalThis.fetch {
  return (async (_input: RequestInfo | URL, _init?: RequestInit) => {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get(name: string) {
          if (headers && headers[name.toLowerCase()]) return headers[name.toLowerCase()]
          return 'application/json'
        },
      },
      json: async () => body,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    } as unknown as Response
  }) as typeof globalThis.fetch
}

// Helper to create an SSE stream response
function mockSSEFetch(events: string[]): typeof globalThis.fetch {
  return (async (_input: RequestInfo | URL, _init?: RequestInit) => {
    const encoder = new TextEncoder()
    let eventIndex = 0

    const stream = new ReadableStream({
      pull(controller) {
        if (eventIndex < events.length) {
          controller.enqueue(encoder.encode(events[eventIndex] + '\n'))
          eventIndex++
        } else {
          controller.close()
        }
      },
    })

    return {
      ok: true,
      status: 200,
      headers: {
        get(name: string) {
          if (name.toLowerCase() === 'content-type') return 'text/event-stream'
          return null
        },
      },
      body: stream,
    } as unknown as Response
  }) as typeof globalThis.fetch
}

describe('API Client', () => {
  beforeEach(() => {
    setupGlobals()
  })

  afterEach(() => {
    teardownGlobals()
  })

  describe('get()', () => {
    it('fetches JSON from a path', async () => {
      globalThis.fetch = mockFetch(200, { status: 'ok' })

      // Dynamic import to pick up mocked globals
      const { get, setBaseUrl } = await import('./client.js')
      setBaseUrl('/api')

      const result = await get<{ status: string }>('/health')
      assert.deepEqual(result, { status: 'ok' })
    })

    it('appends query params', async () => {
      let capturedUrl = ''
      globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit) => {
        capturedUrl = String(input)
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => [],
        } as unknown as Response
      }) as typeof globalThis.fetch

      const { get, setBaseUrl } = await import('./client.js')
      setBaseUrl('/api')

      await get('/sessions', { page: 1, search: 'test' })
      assert.ok(capturedUrl.includes('page=1'))
      assert.ok(capturedUrl.includes('search=test'))
    })
  })

  describe('post()', () => {
    it('sends JSON body and returns response', async () => {
      let capturedInit: RequestInit | undefined
      globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedInit = init
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({ success: true }),
        } as unknown as Response
      }) as typeof globalThis.fetch

      const { post, setBaseUrl } = await import('./client.js')
      setBaseUrl('/api')

      const result = await post<{ success: boolean }>('/sessions/abc/sql', { sql: 'SELECT 1' })
      assert.deepEqual(result, { success: true })
      assert.equal(capturedInit?.method, 'POST')
      assert.equal(
        (capturedInit?.headers as Record<string, string>)['Content-Type'],
        'application/json',
      )
      const body = JSON.parse(capturedInit?.body as string)
      assert.deepEqual(body, { sql: 'SELECT 1' })
    })
  })

  describe('error handling', () => {
    it('throws ApiError on non-ok response with error field', async () => {
      globalThis.fetch = mockFetch(404, { error: 'Not found' })

      const { get, setBaseUrl, ApiError } = await import('./client.js')
      setBaseUrl('/api')

      await assert.rejects(
        () => get('/sessions/missing'),
        (err: unknown) => {
          assert.ok(err instanceof ApiError)
          assert.equal((err as ApiError).status, 404)
          assert.equal((err as ApiError).message, 'Not found')
          return true
        },
      )
    })

    it('throws ApiError with HTTP status when no error field', async () => {
      globalThis.fetch = mockFetch(500, { details: 'something went wrong' })

      const { get, setBaseUrl, ApiError } = await import('./client.js')
      setBaseUrl('/api')

      await assert.rejects(
        () => get('/fail'),
        (err: unknown) => {
          assert.ok(err instanceof ApiError)
          assert.equal((err as ApiError).status, 500)
          assert.equal((err as ApiError).message, 'HTTP 500')
          return true
        },
      )
    })
  })

  describe('upload()', () => {
    it('sends FormData without Content-Type header', async () => {
      let capturedInit: RequestInit | undefined
      globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedInit = init
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({ success: true }),
        } as unknown as Response
      }) as typeof globalThis.fetch

      const { upload, setBaseUrl } = await import('./client.js')
      setBaseUrl('/api')

      const fd = new FormData()
      fd.append('file', new Blob(['test']), 'test.txt')

      await upload('/import', fd)
      assert.equal(capturedInit?.method, 'POST')
      // Should NOT have Content-Type set (browser adds it with boundary)
      assert.equal((capturedInit?.headers as Record<string, string> | undefined), undefined)
    })
  })

  describe('streamPost()', () => {
    it('parses SSE events and calls onEvent', async () => {
      const events = [
        'data: {"type":"content","content":"Hello"}',
        'data: {"type":"done","isFinished":true}',
        '',
      ]
      globalThis.fetch = mockSSEFetch(events)

      const { streamPost, setBaseUrl } = await import('./client.js')
      setBaseUrl('/api')

      const received: Array<{ type: string }> = []
      await streamPost(
        '/agent/run',
        { message: 'test' },
        (event: { type: string }) => received.push(event),
      )

      assert.equal(received.length, 2)
      assert.equal(received[0].type, 'content')
      assert.equal(received[1].type, 'done')
    })
  })

  describe('setBaseUrl() / getBaseUrl()', () => {
    it('trims trailing slashes', async () => {
      const { setBaseUrl, getBaseUrl } = await import('./client.js')
      setBaseUrl('https://example.com/api/')
      assert.equal(getBaseUrl(), 'https://example.com/api')
    })
  })
})
