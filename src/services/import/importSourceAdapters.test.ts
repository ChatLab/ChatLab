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
  it('uses the Electron backend batch API and forwards cancellation', async () => {
    const calls: unknown[][] = []
    let progressCallback: ((progress: any) => void) | undefined
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        chatApi: {
          importBatch: async (...args: unknown[]) => {
            calls.push(['batch', ...args])
            progressCallback?.({
              batchId: args[0],
              batchIndex: 0,
              batchEvent: 'complete',
              stage: 'done',
              percentage: 100,
              batchResult: { id: '0', status: 'success', result: { success: true, sessionId: 'session-1' } },
            })
            return [{ id: '0', status: 'success', result: { success: true, sessionId: 'session-1' } }]
          },
          cancelImportBatch: async (...args: unknown[]) => {
            calls.push(['cancel', ...args])
            return { success: true }
          },
          onImportBatchProgress: (callback: (progress: any) => void) => {
            progressCallback = callback
            return () => {}
          },
        },
      },
    })

    const adapter = new ElectronImportAdapter()
    const progress: unknown[] = []
    const promise = adapter.importBatch?.(
      [{ id: '0', file: '/tmp/first.json' }],
      { sessionGapThreshold: 7200 },
      (event) => progress.push(event)
    )
    adapter.cancelActiveImport?.()
    const result = await promise

    assert.equal(result?.[0].status, 'success')
    assert.equal((result?.[0] as any).result.sessionId, 'session-1')
    assert.equal(calls[0][0], 'batch')
    assert.deepEqual(
      (calls[0][2] as Array<{ filePath: string }>).map((item) => item.filePath),
      ['/tmp/first.json']
    )
    assert.deepEqual(calls[0][3], { sessionGapThreshold: 7200 })
    assert.equal(calls[1][0], 'cancel')
    assert.equal(progress.length, 1)
  })

  it('maps an Electron batch IPC failure to per-item failures', async () => {
    let unlistenCount = 0
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        chatApi: {
          importBatch: async () => {
            throw new Error('worker unavailable')
          },
          onImportBatchProgress: () => () => {
            unlistenCount++
          },
        },
      },
    })

    const adapter = new ElectronImportAdapter()
    const results = await adapter.importBatch?.([
      { id: 'first', file: '/tmp/first.json' },
      { id: 'second', file: '/tmp/second.json' },
    ])

    assert.deepEqual(results, [
      { id: 'first', status: 'failed', error: 'worker unavailable' },
      { id: 'second', status: 'failed', error: 'worker unavailable' },
    ])
    assert.equal(unlistenCount, 1)
  })

  it('forwards the session gap threshold through Electron file import', async () => {
    const calls: unknown[][] = []
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        chatApi: {
          importWithOptions: async (...args: unknown[]) => {
            calls.push(args)
            return { success: true, sessionId: 'session-1' }
          },
          onImportProgress: () => () => {},
        },
      },
    })

    const result = await new ElectronImportAdapter().importFile('/tmp/chat.json', {
      sessionGapThreshold: 7200,
    })

    assert.equal(result.sessionId, 'session-1')
    assert.deepEqual(calls, [['/tmp/chat.json', { sessionGapThreshold: 7200 }]])
  })

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
    assert.equal(
      (
        await adapter.importPreparedChat('source-1', 'Groups/DM sample', undefined, {
          sessionGapThreshold: 7200,
        })
      ).sessionId,
      'session-1'
    )
    await adapter.releaseImportSource('source-1')

    assert.deepEqual(calls, [
      ['prepare', '/tmp/takeout.zip'],
      ['import', 'source-1', 'Groups/DM sample', { sessionGapThreshold: 7200 }],
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
    assert.equal(
      (
        await adapter.importPreparedChat('source-2', 'Groups/DM sample', undefined, {
          sessionGapThreshold: 7200,
        })
      ).sessionId,
      'session-2'
    )
    await adapter.releaseImportSource('source-2')

    assert.equal(requests.length, 3)
    assert.equal(requests[0].url, '/_web/import-sources')
    assert.equal(requests[0].init?.body instanceof FormData, true)
    assert.equal(
      requests[1].init?.headers && new Headers(requests[1].init?.headers).get('Content-Type'),
      'application/json'
    )
    assert.equal(requests[1].init?.body, JSON.stringify({ chatId: 'Groups/DM sample', sessionGapThreshold: 7200 }))
    assert.equal(requests[2].init?.method, 'DELETE')
  })

  it('uploads Web batch files once and maps SSE item results', async () => {
    let request: { url: string; init?: RequestInit } | undefined
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      request = { url: String(input), init }
      return new Response(
        [
          'event: batch-start',
          'data: {"index":0}',
          '',
          'event: batch-complete',
          'data: {"index":0,"result":{"id":"0","status":"success","result":{"success":true,"sessionId":"session-a"}}}',
          '',
          'event: done',
          'data: [{"id":"0","status":"success","result":{"success":true,"sessionId":"session-a"}},{"id":"1","status":"failed","error":"bad file"}]',
          '',
          '',
        ].join('\n'),
        { headers: { 'Content-Type': 'text/event-stream' } }
      )
    }) as typeof fetch

    const progress: unknown[] = []
    const result = await new FetchImportAdapter().importBatch?.(
      [
        { id: 'first', file: new File(['{}'], 'first.json') },
        { id: 'second', file: new File(['{}'], 'second.json') },
      ],
      { sessionGapThreshold: 7200 },
      (event) => progress.push(event)
    )

    assert.equal(request?.url, '/_web/import/batch')
    assert.equal(request?.init?.body instanceof FormData, true)
    const form = request?.init?.body as FormData
    assert.equal(form.getAll('files').length, 2)
    assert.equal(form.get('sessionGapThreshold'), '7200')
    assert.deepEqual(
      result?.map((item) => ({ id: item.id, status: item.status })),
      [
        { id: 'first', status: 'success' },
        { id: 'second', status: 'failed' },
      ]
    )
    assert.equal(progress.length, 2)
  })

  it('preserves a server batch error for items without completed results', async () => {
    globalThis.fetch = (async () =>
      new Response(
        [
          'event: batch-complete',
          'data: {"index":0,"result":{"id":"0","status":"success","result":{"success":true,"sessionId":"session-a"}}}',
          '',
          'event: error',
          'data: {"error":"compatibility gate unavailable"}',
          '',
          '',
        ].join('\n'),
        { headers: { 'Content-Type': 'text/event-stream' } }
      )) as typeof fetch

    const results = await new FetchImportAdapter().importBatch?.([
      { id: 'first', file: new File(['{}'], 'first.json') },
      { id: 'second', file: new File(['{}'], 'second.json') },
    ])

    assert.deepEqual(results, [
      {
        id: 'first',
        status: 'success',
        result: {
          success: true,
          sessionId: 'session-a',
          platform: undefined,
          error: undefined,
          importMode: undefined,
          matchedBy: undefined,
          createReason: undefined,
          newMessageCount: undefined,
          duplicateCount: undefined,
          messageCount: undefined,
          memberCount: undefined,
          diagnostics: undefined,
        },
      },
      { id: 'second', status: 'failed', error: 'compatibility gate unavailable' },
    ])
  })

  it('keeps the Web batch stream open until cancellation returns authoritative results', async () => {
    const requests: Array<{ url: string; batchId?: string }> = []
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/cancel')) {
        requests.push({ url })
        streamController?.enqueue(
          new TextEncoder().encode(
            [
              'event: batch-complete',
              'data: {"index":0,"result":{"id":"0","status":"success","result":{"success":true,"sessionId":"session-a"}}}',
              '',
              'event: batch-complete',
              'data: {"index":1,"result":{"id":"1","status":"cancelled"}}',
              '',
              'event: done',
              'data: [{"id":"0","status":"success","result":{"success":true,"sessionId":"session-a"}},{"id":"1","status":"cancelled"}]',
              '',
              '',
            ].join('\n')
          )
        )
        streamController?.close()
        return new Response(JSON.stringify({ success: true, active: true }))
      }

      const batchId = new Headers(init?.headers).get('X-ChatLab-Import-Batch-Id') ?? undefined
      requests.push({ url, batchId })
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller
        },
      })
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
    }) as typeof fetch

    const adapter = new FetchImportAdapter()
    const resultPromise = adapter.importBatch?.([
      { id: 'first', file: new File(['{}'], 'first.json') },
      { id: 'second', file: new File(['{}'], 'second.json') },
    ])
    await new Promise((resolve) => setTimeout(resolve, 0))
    adapter.cancelActiveImport?.()
    const results = await resultPromise

    assert.deepEqual(
      results?.map((result) => ({ id: result.id, status: result.status })),
      [
        { id: 'first', status: 'success' },
        { id: 'second', status: 'cancelled' },
      ]
    )
    assert.equal(requests.length, 2)
    assert.ok(requests[0].batchId)
    assert.equal(requests[1].url, `/_web/import/batch/${requests[0].batchId}/cancel`)
  })

  it('sends the browser timezone when importing Demo sessions through CLI Web', async () => {
    let requestBody: string | undefined
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body as string | undefined
      return new Response('event: result\ndata: {"success":true,"groupSessionId":"group"}\n\n', {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as typeof fetch

    const adapter = new FetchImportAdapter()
    const result = await adapter.importDemo('cn', undefined, { sessionGapThreshold: 7200 })

    assert.equal(result.success, true)
    assert.deepEqual(JSON.parse(requestBody ?? ''), {
      locale: 'cn',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      sessionGapThreshold: 7200,
    })
  })

  it('preserves failed directory-import platform metadata from SSE', async () => {
    globalThis.fetch = (async () =>
      new Response('event: error\ndata: {"success":false,"platform":"line","error":"database unavailable"}\n\n', {
        headers: { 'Content-Type': 'text/event-stream' },
      })) as typeof fetch

    const result = await new FetchImportAdapter().importDirectory([new File(['{}'], 'chat.json')])

    assert.deepEqual(result, {
      success: false,
      sessionId: undefined,
      platform: 'line',
      error: 'database unavailable',
      importMode: undefined,
      matchedBy: undefined,
      createReason: undefined,
      newMessageCount: undefined,
      duplicateCount: undefined,
      messageCount: undefined,
      memberCount: undefined,
      diagnostics: undefined,
    })
  })
})
