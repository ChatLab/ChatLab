import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CliWebPlatformAdapter } from './cli-web'

function replaceGlobal(name: string, value: unknown): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name)
  Object.defineProperty(globalThis, name, { configurable: true, value })
  return () => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else delete (globalThis as Record<string, unknown>)[name]
  }
}

describe('CliWebPlatformAdapter', () => {
  it('uses the bundled web version for display without querying the CLI server', async () => {
    const originalFetch = globalThis.fetch
    const requestedUrls: string[] = []
    globalThis.fetch = ((input: RequestInfo | URL) => {
      requestedUrls.push(String(input))
      return Promise.resolve(new Response(JSON.stringify({ version: '0.0.0' })))
    }) as typeof fetch

    try {
      assert.equal(await new CliWebPlatformAdapter().getVersion(), 'cli-web')
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
      const result = await new CliWebPlatformAdapter().performUpdate()

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
      assert.equal(await new CliWebPlatformAdapter().getAnalyticsEnabled(), true)
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
      const result = await new CliWebPlatformAdapter().setAnalyticsEnabled(false)
      assert.deepEqual(result, { success: true })
      assert.equal(requests[0].url, '/_web/telemetry/enabled')
      assert.equal(requests[0].init?.method, 'POST')
      assert.equal(requests[0].init?.body, JSON.stringify({ enabled: false }))
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('writes a PNG data URL to the browser image clipboard', async () => {
    const originalFetch = globalThis.fetch
    let clipboardItems: unknown[] = []

    class MockClipboardItem {
      constructor(readonly data: Record<string, Blob | Promise<Blob>>) {}
    }

    const restoreNavigator = replaceGlobal('navigator', {
      clipboard: {
        write: async (items: unknown[]) => {
          clipboardItems = items
        },
      },
    })
    const restoreClipboardItem = replaceGlobal('ClipboardItem', MockClipboardItem)
    const restoreSecureContext = replaceGlobal('isSecureContext', true)
    globalThis.fetch = ((input: RequestInfo | URL) => {
      assert.equal(String(input), 'data:image/png;base64,aGVsbG8=')
      return Promise.resolve(new Response(new Blob(['hello'], { type: 'image/png' })))
    }) as typeof fetch

    try {
      const result = await new CliWebPlatformAdapter().copyImageToClipboard('data:image/png;base64,aGVsbG8=')

      assert.deepEqual(result, { success: true })
      assert.equal(clipboardItems.length, 1)
      const item = clipboardItems[0] as MockClipboardItem
      const png = await item.data['image/png']
      assert.equal(png.type, 'image/png')
      assert.equal(await png.text(), 'hello')
    } finally {
      globalThis.fetch = originalFetch
      restoreSecureContext()
      restoreClipboardItem()
      restoreNavigator()
    }
  })

  it('reports unsupported image clipboard APIs without attempting a write', async () => {
    const restoreNavigator = replaceGlobal('navigator', { clipboard: {} })
    const restoreClipboardItem = replaceGlobal('ClipboardItem', undefined)
    const restoreSecureContext = replaceGlobal('isSecureContext', true)

    try {
      const result = await new CliWebPlatformAdapter().copyImageToClipboard('data:image/png;base64,aGVsbG8=')
      assert.deepEqual(result, {
        success: false,
        error: 'Image clipboard is not supported by this browser',
      })
    } finally {
      restoreSecureContext()
      restoreClipboardItem()
      restoreNavigator()
    }
  })

  it('rejects image clipboard writes outside a secure context', async () => {
    const restoreSecureContext = replaceGlobal('isSecureContext', false)

    try {
      const result = await new CliWebPlatformAdapter().copyImageToClipboard('data:image/png;base64,aGVsbG8=')
      assert.deepEqual(result, {
        success: false,
        error: 'Image clipboard requires HTTPS or localhost',
      })
    } finally {
      restoreSecureContext()
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
      const result = await new CliWebPlatformAdapter().fetchRemoteConfig('https://example.com/skills/skill_md.md')
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
      const result = await new CliWebPlatformAdapter().fetchRemoteConfig('https://example.com/cn/skill.json')
      assert.deepEqual(result.data, [1, 2, 3])
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
