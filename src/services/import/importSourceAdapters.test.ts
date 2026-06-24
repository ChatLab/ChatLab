import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { configureHttpClient } from '../utils/http'
import { ElectronImportAdapter } from './electron'
import { FetchImportAdapter } from './fetch'

const originalFetch = globalThis.fetch
const originalWindow = globalThis.window

afterEach(() => {
  globalThis.fetch = originalFetch
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  })
  configureHttpClient({ baseUrl: '/_web', token: '', getToken: null, on401: null })
})

describe('archive import source adapters', () => {
  it('forwards Electron source lifecycle calls through preload', async () => {
    const calls: unknown[][] = []
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        chatApi: {
          prepareImportSource: async (...args: unknown[]) => {
            calls.push(['prepare', ...args])
            return {
              success: true,
              source: {
                sourceId: 'source-1',
                formatId: 'google-chat-takeout',
                platform: 'google-chat',
                chats: [],
                expiresAt: 123,
              },
            }
          },
          importPreparedChat: async (...args: unknown[]) => {
            calls.push(['import', ...args])
            return { success: true, sessionId: 'session-1' }
          },
          releaseImportSource: async (...args: unknown[]) => {
            calls.push(['release', ...args])
            return { success: true }
          },
          onImportProgress: () => () => {},
        },
      },
    })

    const adapter = new ElectronImportAdapter()
    assert.equal((await adapter.prepareImportSource('/tmp/takeout.zip')).source?.sourceId, 'source-1')
    assert.equal((await adapter.importPreparedChat('source-1', 'Groups/DM sample')).sessionId, 'session-1')
    await adapter.releaseImportSource('source-1')

    assert.deepEqual(calls, [
      ['prepare', '/tmp/takeout.zip'],
      ['import', 'source-1', 'Groups/DM sample'],
      ['release', 'source-1'],
    ])
  })

  it('uploads a Web source once and imports selected chats with JSON', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.endsWith('/import-sources') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            success: true,
            source: {
              sourceId: 'source-2',
              formatId: 'google-chat-takeout',
              platform: 'google-chat',
              chats: [],
              expiresAt: 456,
            },
          })
        )
      }
      if (url.endsWith('/import-sources/source-2/import')) {
        return new Response('event: done\ndata: {"success":true,"sessionId":"session-2"}\n\n', {
          headers: { 'Content-Type': 'text/event-stream' },
        })
      }
      return new Response(JSON.stringify({ success: true }))
    }) as typeof fetch

    const adapter = new FetchImportAdapter()
    const file = new File(['zip'], 'takeout.zip', { type: 'application/zip' })
    assert.equal((await adapter.prepareImportSource(file)).source?.sourceId, 'source-2')
    assert.equal((await adapter.importPreparedChat('source-2', 'Groups/DM sample')).sessionId, 'session-2')
    await adapter.releaseImportSource('source-2')

    assert.equal(requests.length, 3)
    assert.equal(requests[0].url, '/_web/import-sources')
    assert.equal(requests[0].init?.body instanceof FormData, true)
    assert.equal(
      requests[1].init?.headers && new Headers(requests[1].init?.headers).get('Content-Type'),
      'application/json'
    )
    assert.equal(requests[1].init?.body, JSON.stringify({ chatId: 'Groups/DM sample' }))
    assert.equal(requests[2].init?.method, 'DELETE')
  })
})
