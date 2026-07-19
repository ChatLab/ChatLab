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
