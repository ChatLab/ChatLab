import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type {
  RpcRequestOptions,
  WebRuntimeTaskPayload,
  WebRuntimeTaskResult,
  WebRuntimeTaskType,
} from '@openchatlab/web-runtime'
import { BrowserImportAdapter } from './browser'

function createFile(name = 'fixture.json', content = '{}', type = 'application/json'): File {
  const blob = new Blob([content], { type })
  return {
    name,
    size: blob.size,
    type: blob.type,
    text: () => blob.text(),
    arrayBuffer: () => blob.arrayBuffer(),
    slice: (start?: number, end?: number) => blob.slice(start, end),
  } as File
}

function demoTimestamp(date: string, time: string): number {
  return Math.floor(new Date(`${date}T${time}+08:00`).getTime() / 1000)
}

function createDemoDocument(name: string, timestamps: number[]): string {
  return JSON.stringify({
    chatlab: {
      version: '0.0.2',
      exportedAt: demoTimestamp('2000-01-01', '00:00:00'),
      generator: 'ChatLab Demo',
      description: 'x'.repeat(128),
      demoTimeline: {
        version: 1,
        mode: 'relative',
        referenceYear: 2000,
        timeZoneOffsetMinutes: 480,
      },
    },
    meta: { name, platform: 'qq', type: 'private' },
    members: [],
    messages: timestamps.map((timestamp, index) => ({
      sender: '1',
      accountName: 'Demo',
      timestamp,
      type: 0,
      platformMessageId: `${name}-${index}`,
      content: 'demo',
    })),
  })
}

describe('BrowserImportAdapter', () => {
  it('forwards detection, supported formats, import progress, and the result through RPC', async () => {
    const requests: WebRuntimeTaskType[] = []
    const rpc = {
      async request<T extends WebRuntimeTaskType>(
        type: T,
        _payload: WebRuntimeTaskPayload<T>,
        options: RpcRequestOptions = {}
      ): Promise<WebRuntimeTaskResult<T>> {
        requests.push(type)
        if (type === 'import.start') {
          options.onProgress?.({
            taskType: 'import.start',
            stage: 'parsing',
            progress: 0.5,
            messagesProcessed: 10,
          })
          return {
            sessionId: 'session-one',
            formatId: 'chatlab',
            messageCount: 20,
            memberCount: 2,
            skippedCount: 0,
          } as WebRuntimeTaskResult<T>
        }
        const format = { id: 'chatlab', name: 'ChatLab JSON', platform: 'unknown', extensions: ['.json'] }
        return (type === 'import.formats' ? [format] : format) as WebRuntimeTaskResult<T>
      },
      dispose: () => undefined,
    }
    const adapter = new BrowserImportAdapter(rpc)
    const progress: Array<{ stage: string; progress: number; messagesProcessed?: number }> = []

    assert.equal((await adapter.detectFormat(createFile()))?.id, 'chatlab')
    assert.equal((await adapter.getSupportedFormats())[0].id, 'chatlab')
    const result = await adapter.importFile(createFile(), { formatId: 'chatlab' }, (event) => progress.push(event))

    assert.deepEqual(result, {
      success: true,
      sessionId: 'session-one',
      importMode: 'created',
      newMessageCount: 20,
      messageCount: 20,
      memberCount: 2,
    })
    assert.deepEqual(progress, [{ stage: 'parsing', progress: 50, messagesProcessed: 10 }])
    assert.deepEqual(requests, ['import.detectFormat', 'import.formats', 'import.start'])
  })

  it('cancels the active RPC request and rejects unsupported import modes explicitly', async () => {
    let signal: AbortSignal | undefined
    const rpc = {
      request<T extends WebRuntimeTaskType>(
        _type: T,
        _payload: WebRuntimeTaskPayload<T>,
        options: RpcRequestOptions = {}
      ): Promise<WebRuntimeTaskResult<T>> {
        signal = options.signal
        return new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
        })
      },
      dispose: () => undefined,
    }
    const adapter = new BrowserImportAdapter(rpc)

    const pending = adapter.importFile(createFile())
    adapter.cancelActiveImport()
    assert.equal(signal?.aborted, true)
    assert.deepEqual(await pending, { success: false, error: 'cancelled' })
    await assert.rejects(adapter.scanMultiChatFile('fixture.json'), /File path import is not available/i)
    await assert.rejects(adapter.incrementalImport('session-one', createFile()), /not available in Web WASM/i)
  })

  it('downloads and imports the group and Wukong demo files through the browser runtime', async () => {
    const requestedUrls: string[] = []
    const importedFiles: string[] = []
    const importedDocuments: any[] = []
    const sourceLatest = demoTimestamp('2000-12-10', '22:30:00')
    const documents = [
      createDemoDocument('group', [demoTimestamp('2000-02-01', '09:00:00'), sourceLatest]),
      createDemoDocument('private-wukong', [demoTimestamp('2000-06-01', '10:00:00')]),
    ]
    const now = new Date('2026-07-25T04:00:00.000Z')
    let downloadIndex = 0
    const fetchDemo: typeof fetch = async function (this: unknown, input) {
      assert.equal(this, globalThis)
      requestedUrls.push(String(input))
      return new Response(documents[downloadIndex++], {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    const rpc = {
      async request<T extends WebRuntimeTaskType>(
        type: T,
        payload: WebRuntimeTaskPayload<T>
      ): Promise<WebRuntimeTaskResult<T>> {
        if (type !== 'import.start') throw new Error(`Unexpected task: ${type}`)
        const source = (payload as WebRuntimeTaskPayload<'import.start'>).source as File
        importedFiles.push(source.name)
        importedDocuments.push(JSON.parse(await source.text()))
        return {
          sessionId: `session-${importedFiles.length}`,
          formatId: 'chatlab',
          messageCount: 10,
          memberCount: 2,
          skippedCount: 0,
        } as WebRuntimeTaskResult<T>
      },
      dispose: () => undefined,
    }
    const adapter = new BrowserImportAdapter(rpc, fetchDemo, () => now)
    const progress: string[] = []

    const result = await adapter.importDemo('cn', (event) => progress.push(event.stage))

    assert.deepEqual(requestedUrls, ['/api/demo/cn/demo-group.json', '/api/demo/cn/demo-private-B-wukong.json'])
    assert.deepEqual(importedFiles, ['demo-group.json', 'demo-private-B-wukong.json'])
    const expectedLatest = new Date(now)
    expectedLatest.setDate(expectedLatest.getDate() - 1)
    expectedLatest.setHours(22, 30, 0, 0)
    const latestTimestamp = Math.floor(expectedLatest.getTime() / 1000)
    const offset = latestTimestamp - sourceLatest
    assert.equal(importedDocuments[0].messages[1].timestamp, latestTimestamp)
    assert.equal(importedDocuments[1].messages[0].timestamp, demoTimestamp('2000-06-01', '10:00:00') + offset)
    assert.ok(importedDocuments.every((document) => document.chatlab.exportedAt === Math.floor(now.getTime() / 1000)))
    assert.deepEqual(progress, ['downloading', 'downloading', 'importing', 'importing'])
    assert.deepEqual(result, {
      success: true,
      groupSessionId: 'session-1',
      privateSessionIds: ['session-2'],
    })
  })

  it('returns a failed demo result without importing when a download fails', async () => {
    let importRequests = 0
    const rpc = {
      async request<T extends WebRuntimeTaskType>(): Promise<WebRuntimeTaskResult<T>> {
        importRequests += 1
        throw new Error('Import should not start')
      },
      dispose: () => undefined,
    }
    const adapter = new BrowserImportAdapter(rpc, async () => new Response(null, { status: 503 }))

    const result = await adapter.importDemo('en')

    assert.equal(result.success, false)
    assert.match(result.error ?? '', /HTTP 503/)
    assert.equal(importRequests, 0)
  })

  it('times out a stalled demo response body and releases the active import', async () => {
    let importRequests = 0
    const rpc = {
      async request<T extends WebRuntimeTaskType>(): Promise<WebRuntimeTaskResult<T>> {
        importRequests += 1
        throw new Error('Import should not start')
      },
      dispose: () => undefined,
    }
    const fetchDemo: typeof fetch = async (_input, init) => {
      const signal = init?.signal
      return new Response(
        new ReadableStream({
          start(controller) {
            signal?.addEventListener('abort', () => controller.error(signal.reason), { once: true })
          },
        })
      )
    }
    const adapter = new BrowserImportAdapter(rpc, fetchDemo, () => new Date(), 10)
    const pending = adapter.importDemo('en')
    let watchdog: ReturnType<typeof setTimeout> | undefined

    try {
      const result = await Promise.race([
        pending,
        new Promise<'still-pending'>((resolve) => {
          watchdog = setTimeout(() => resolve('still-pending'), 100)
        }),
      ])
      if (result === 'still-pending') assert.fail('Demo download did not time out')

      assert.equal(result.success, false)
      assert.match(result.error ?? '', /timed out/i)
      assert.equal(importRequests, 0)

      const retry = await adapter.importDemo('en')
      assert.match(retry.error ?? '', /timed out/i)
    } finally {
      if (watchdog) clearTimeout(watchdog)
      adapter.cancelActiveImport()
      await pending
    }
  })

  it('deletes sessions created earlier in the batch when a later demo import fails', async () => {
    const deletedSessionIds: string[] = []
    const importError = new Error('second import failed')
    let importCount = 0
    const documents = [
      createDemoDocument('group', [demoTimestamp('2000-12-10', '22:30:00')]),
      createDemoDocument('private-wukong', [demoTimestamp('2000-12-08', '20:00:00')]),
    ]
    let downloadIndex = 0
    const rpc = {
      async request<T extends WebRuntimeTaskType>(
        type: T,
        payload: WebRuntimeTaskPayload<T>
      ): Promise<WebRuntimeTaskResult<T>> {
        if (type === 'import.start') {
          importCount += 1
          if (importCount === 2) throw importError
          return {
            sessionId: `session-${importCount}`,
            formatId: 'chatlab',
            messageCount: 1,
            memberCount: 1,
            skippedCount: 0,
          } as WebRuntimeTaskResult<T>
        }
        if (type === 'session.delete') {
          deletedSessionIds.push((payload as WebRuntimeTaskPayload<'session.delete'>).sessionId)
          return { deleted: true } as WebRuntimeTaskResult<T>
        }
        throw new Error(`Unexpected task: ${type}`)
      },
      dispose: () => undefined,
    }
    const adapter = new BrowserImportAdapter(
      rpc,
      async () => new Response(documents[downloadIndex++], { status: 200 }),
      () => new Date('2026-07-25T04:00:00.000Z')
    )

    const result = await adapter.importDemo('en')

    assert.equal(result.success, false)
    assert.match(result.error ?? '', /second import failed/)
    assert.deepEqual(deletedSessionIds, ['session-1'])
  })

  it('forwards browser-safe format identifiers to the worker runtime', async () => {
    const requestedFormats: string[] = []
    const rpc = {
      async request<T extends WebRuntimeTaskType>(
        type: T,
        payload: WebRuntimeTaskPayload<T>
      ): Promise<WebRuntimeTaskResult<T>> {
        if (type !== 'import.start') throw new Error(`Unexpected task: ${type}`)
        const formatId = (payload as WebRuntimeTaskPayload<'import.start'>).formatId
        if (formatId) requestedFormats.push(formatId)
        return {
          sessionId: `${formatId}-session`,
          formatId,
          messageCount: 2,
          memberCount: 2,
          skippedCount: 0,
        } as WebRuntimeTaskResult<T>
      },
      dispose: () => undefined,
    }
    const adapter = new BrowserImportAdapter(rpc)

    const weflow = await adapter.importFile(createFile('weflow.json'), { formatId: 'weflow' })

    const whatsapp = await adapter.importFile(
      createFile('与Alice的 WhatsApp 聊天.txt', 'Messages and calls are end-to-end encrypted.', 'text/plain'),
      { formatId: 'whatsapp-native-txt' }
    )
    const line = await adapter.importFile(
      createFile('[LINE] Project Team.txt', '[LINE] Chat history in Project Team', 'text/plain'),
      { formatId: 'line-native-txt' }
    )
    const qq = await adapter.importFile(
      createFile('qq-group.txt', '消息记录（此消息记录为文本格式，不支持重新导入）', 'text/plain'),
      { formatId: 'qq-native-txt' }
    )
    const telegram = await adapter.importFile(
      createFile(
        'result.json',
        JSON.stringify({ name: 'Project Team', type: 'private_group', id: 4242, messages: [] }),
        'application/json'
      ),
      { formatId: 'telegram-native-single' }
    )

    assert.equal(weflow.success, true)
    assert.equal(whatsapp.success, true)
    assert.equal(line.success, true)
    assert.equal(qq.success, true)
    assert.equal(telegram.success, true)
    assert.deepEqual(requestedFormats, [
      'weflow',
      'whatsapp-native-txt',
      'line-native-txt',
      'qq-native-txt',
      'telegram-native-single',
    ])
  })

  it('scans Telegram chats and forwards the selected chat index to the worker', async () => {
    const requests: Array<{ type: WebRuntimeTaskType; payload: unknown }> = []
    const rpc = {
      async request<T extends WebRuntimeTaskType>(
        type: T,
        payload: WebRuntimeTaskPayload<T>
      ): Promise<WebRuntimeTaskResult<T>> {
        requests.push({ type, payload })
        if (type === 'import.scanChats') {
          return [
            { index: 0, name: 'Alice', type: 'personal_chat', id: 10001, messageCount: 1 },
            { index: 1, name: 'Project Team', type: 'private_group', id: 4242, messageCount: 2 },
          ] as WebRuntimeTaskResult<T>
        }
        if (type === 'import.start') {
          return {
            sessionId: 'telegram-team',
            formatId: 'telegram-native',
            messageCount: 2,
            memberCount: 1,
            skippedCount: 0,
          } as WebRuntimeTaskResult<T>
        }
        throw new Error(`Unexpected task: ${type}`)
      },
      dispose: () => undefined,
    }
    const adapter = new BrowserImportAdapter(rpc)
    const file = createFile('result.json')

    assert.equal((await adapter.scanMultiChatFile(file)).length, 2)
    assert.equal((await adapter.importFile(file, { formatId: 'telegram-native', chatIndex: 1 })).success, true)
    assert.equal(requests[0].type, 'import.scanChats')
    assert.equal(requests[1].type, 'import.start')
    assert.equal((requests[1].payload as WebRuntimeTaskPayload<'import.start'>).chatIndex, 1)
  })
})
