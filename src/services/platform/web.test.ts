import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { WebPlatformAdapter } from './web'

describe('WebPlatformAdapter', () => {
  it('uses the bundled web version for display without querying the CLI server', async () => {
    const originalFetch = globalThis.fetch
    const requestedUrls: string[] = []
    globalThis.fetch = ((input: RequestInfo | URL) => {
      requestedUrls.push(String(input))
      return Promise.resolve(new Response(JSON.stringify({ version: '0.0.0' })))
    }) as typeof fetch

    try {
      assert.equal(await new WebPlatformAdapter().getVersion(), 'web')
      assert.deepEqual(requestedUrls, [])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('does not bootstrap self-update auth from public web config', async () => {
    const originalFetch = globalThis.fetch
    const requestedUrls: string[] = []
    globalThis.fetch = ((input: RequestInfo | URL) => {
      requestedUrls.push(String(input))
      return Promise.resolve(new Response('{}'))
    }) as typeof fetch

    try {
      const result = await new WebPlatformAdapter().performUpdate()

      assert.equal(result.success, false)
      assert.equal(requestedUrls.length, 0)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('reads analytics enabled state from the CLI web backend', async () => {
    const originalFetch = globalThis.fetch
    const requestedUrls: string[] = []
    globalThis.fetch = ((input: RequestInfo | URL) => {
      requestedUrls.push(String(input))
      return Promise.resolve(new Response(JSON.stringify({ enabled: true })))
    }) as typeof fetch

    try {
      assert.equal(await new WebPlatformAdapter().getAnalyticsEnabled(), true)
      assert.deepEqual(requestedUrls, ['/_web/telemetry/enabled'])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('writes analytics enabled state to the CLI web backend', async () => {
    const originalFetch = globalThis.fetch
    const requests: Array<{ url: string; init?: RequestInit }> = []
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init })
      return Promise.resolve(new Response(JSON.stringify({ success: true })))
    }) as typeof fetch

    try {
      const result = await new WebPlatformAdapter().setAnalyticsEnabled(false)
      assert.deepEqual(result, { success: true })
      assert.equal(requests[0].url, '/_web/telemetry/enabled')
      assert.equal(requests[0].init?.method, 'POST')
      assert.equal(requests[0].init?.body, JSON.stringify({ enabled: false }))
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
