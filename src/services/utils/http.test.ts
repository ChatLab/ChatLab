import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { configureHttpClient, fetchWithAuth, getAuthHeaders, getBaseUrl } from './http'

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
})
