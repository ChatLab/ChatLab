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
})
