import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  configureHttpClient,
  fetchWithAuth,
  getAuthHeaders,
  getBaseUrl,
  analyticsGet,
  abortAnalyticsRequests,
} from './http'

describe('http client', () => {
  beforeEach(() => {
    configureHttpClient({ baseUrl: '/_web', token: '', getToken: null, on401: null })
  })

  describe('getAuthHeaders', () => {
    it('returns empty when no token', () => {
      assert.deepEqual(getAuthHeaders(), {})
    })

    it('returns Bearer header with static token', () => {
      configureHttpClient({ token: 'abc' })
      assert.deepEqual(getAuthHeaders(), { Authorization: 'Bearer abc' })
    })

    it('prefers getToken callback over static token', () => {
      configureHttpClient({ token: 'old', getToken: () => 'dynamic' })
      assert.deepEqual(getAuthHeaders(), { Authorization: 'Bearer dynamic' })
    })

    it('returns empty when getToken returns empty string', () => {
      configureHttpClient({ getToken: () => '' })
      assert.deepEqual(getAuthHeaders(), {})
    })
  })

  describe('getBaseUrl', () => {
    it('defaults to /_web', () => {
      assert.equal(getBaseUrl(), '/_web')
    })

    it('returns configured baseUrl', () => {
      configureHttpClient({ baseUrl: '/custom' })
      assert.equal(getBaseUrl(), '/custom')
    })
  })

  describe('fetchWithAuth', () => {
    it('injects Authorization header from getToken', async () => {
      let capturedHeaders: Headers | undefined
      const originalFetch = globalThis.fetch
      globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
        capturedHeaders = new Headers(init?.headers)
        return Promise.resolve(new Response('{}', { status: 200 }))
      }) as typeof fetch

      try {
        configureHttpClient({ getToken: () => 'tok123' })
        await fetchWithAuth('/test')
        assert.equal(capturedHeaders?.get('Authorization'), 'Bearer tok123')
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('calls on401 when response is 401', async () => {
      const originalFetch = globalThis.fetch
      let on401Called = false
      globalThis.fetch = (() => Promise.resolve(new Response('', { status: 401 }))) as typeof fetch

      try {
        configureHttpClient({
          on401: () => {
            on401Called = true
          },
        })
        await fetchWithAuth('/test')
        assert.equal(on401Called, true)
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('does not call on401 for non-401 responses', async () => {
      const originalFetch = globalThis.fetch
      let on401Called = false
      globalThis.fetch = (() => Promise.resolve(new Response('', { status: 403 }))) as typeof fetch

      try {
        configureHttpClient({
          on401: () => {
            on401Called = true
          },
        })
        await fetchWithAuth('/test')
        assert.equal(on401Called, false)
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('does not override existing Authorization header', async () => {
      let capturedHeaders: Headers | undefined
      const originalFetch = globalThis.fetch
      globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
        capturedHeaders = new Headers(init?.headers)
        return Promise.resolve(new Response('{}', { status: 200 }))
      }) as typeof fetch

      try {
        configureHttpClient({ getToken: () => 'auto-token' })
        await fetchWithAuth('/test', {
          headers: { Authorization: 'Bearer explicit-token' },
        })
        assert.equal(capturedHeaders?.get('Authorization'), 'Bearer explicit-token')
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  describe('analytics request cancellation', () => {
    // 模拟真实 fetch：捕获 signal，并在 abort 时以 AbortError 拒绝（其余保持 pending）。
    function abortableFetch(captured: { signal?: AbortSignal | null }) {
      return ((_input: unknown, init?: RequestInit) => {
        captured.signal = init?.signal
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal
          if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'))
            return
          }
          signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        })
      }) as typeof fetch
    }

    it('passes a non-aborted signal and abortAnalyticsRequests() cancels the in-flight request', async () => {
      const originalFetch = globalThis.fetch
      const captured: { signal?: AbortSignal | null } = {}
      globalThis.fetch = abortableFetch(captured)

      try {
        const pending = analyticsGet('/stats/x')
        assert.equal(captured.signal?.aborted, false)

        abortAnalyticsRequests()
        assert.equal(captured.signal?.aborted, true)

        // 已作废请求不应 settle（既不 resolve 也不以 AbortError 拒绝调用方）。
        let settled = false
        void pending.then(
          () => {
            settled = true
          },
          () => {
            settled = true
          }
        )
        await new Promise((r) => setTimeout(r, 10))
        assert.equal(settled, false)
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('issues a fresh (non-aborted) signal after abortAnalyticsRequests()', async () => {
      const originalFetch = globalThis.fetch

      try {
        // 先让上一 epoch 处于已 abort 状态
        globalThis.fetch = abortableFetch({})
        void analyticsGet('/stats/old').catch(() => {})
        abortAnalyticsRequests()

        const captured: { signal?: AbortSignal | null } = {}
        globalThis.fetch = abortableFetch(captured)
        void analyticsGet('/stats/new').catch(() => {})
        assert.equal(captured.signal?.aborted, false)
      } finally {
        abortAnalyticsRequests()
        globalThis.fetch = originalFetch
      }
    })
  })
})
