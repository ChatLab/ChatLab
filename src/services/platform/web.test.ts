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

  it('parses markdown skill bodies as text instead of JSON', async () => {
    // Regression: importing a skill from the cloud market failed with
    // "SyntaxError: No number after minus sign in JSON..." because
    // fetchRemoteConfig hard-coded res.json() for every response.
    const originalFetch = globalThis.fetch
    const md = `---\nid: skill_md\nname: Markdown Skill\ndescription: desc\n---\nbody text`
    globalThis.fetch = (() =>
      Promise.resolve(new Response(md, { headers: { 'content-type': 'text/markdown' } }))) as typeof fetch

    try {
      const result = await new WebPlatformAdapter().fetchRemoteConfig('https://example.com/skills/skill_md.md')
      assert.equal(result.success, true)
      assert.equal(result.data, md)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('parses .json URLs as JSON even without an application/json content-type', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (() =>
      Promise.resolve(new Response('[1,2,3]', { headers: { 'content-type': 'text/plain' } }))) as typeof fetch

    try {
      const result = await new WebPlatformAdapter().fetchRemoteConfig('https://example.com/cn/skill.json')
      assert.deepEqual(result.data, [1, 2, 3])
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
