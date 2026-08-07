import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { describe, it } from 'node:test'

import type { RuntimeConversation, RuntimeMessage } from '@openchatlab/ai-runtime'
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test'

import { WebModelConfigStore, type BrowserKeyValueStore } from './model-config-store'
import type { CreatedWebModel } from './provider-factory'
import type { WebRuntimeRpcPort } from './rpc-adapters'
import { WebAIChatRuntime } from './runtime'
import { WebAIRuntimeError } from './errors'

const EMPTY_USAGE = {
  inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 4, text: 4, reasoning: 0 },
}

class MemoryKeyValueStore implements BrowserKeyValueStore {
  private readonly values = new Map<string, unknown>()
  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value)
  }
  async delete(key: string): Promise<void> {
    this.values.delete(key)
  }
}

function createRpc(toolListPayloads: unknown[] = [], messageListGate?: Promise<void>): WebRuntimeRpcPort {
  const conversations = new Map<string, RuntimeConversation>()
  const messages: RuntimeMessage[] = []
  let sequence = 0
  return {
    request: async (type, payload) => {
      switch (type) {
        case 'ai.conversation.create': {
          const input = payload as { sessionId: string; title?: string | null }
          const conversation: RuntimeConversation = {
            id: `conversation-${++sequence}`,
            sessionId: input.sessionId,
            title: input.title ?? null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }
          conversations.set(conversation.id, conversation)
          return conversation as never
        }
        case 'ai.conversation.get':
          return (conversations.get((payload as { conversationId: string }).conversationId) ?? null) as never
        case 'ai.message.list':
          await messageListGate
          return messages.filter(
            (message) => message.conversationId === (payload as { conversationId: string }).conversationId
          ) as never
        case 'ai.message.append': {
          const input = payload as Omit<RuntimeMessage, 'id' | 'createdAt'>
          const message: RuntimeMessage = {
            ...input,
            id: `message-${++sequence}`,
            createdAt: Date.now(),
          }
          messages.push(message)
          return message as never
        }
        case 'ai.message.update': {
          const input = payload as { messageId: string; patch: Partial<RuntimeMessage> }
          const message = messages.find((item) => item.id === input.messageId)
          if (message) Object.assign(message, input.patch)
          return undefined as never
        }
        case 'ai.message.delete': {
          const index = messages.findIndex((message) => message.id === (payload as { messageId: string }).messageId)
          if (index >= 0) messages.splice(index, 1)
          return { deleted: index >= 0 } as never
        }
        case 'ai.tool.list':
          toolListPayloads.push(payload)
          return [] as never
        default:
          throw new Error(`Unexpected test RPC task: ${type}`)
      }
    },
  }
}

function stream(text: string) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: 'stream-start' as const, warnings: [] },
        { type: 'text-start' as const, id: 'text' },
        { type: 'text-delta' as const, id: 'text', delta: text },
        { type: 'text-end' as const, id: 'text' },
        { type: 'finish' as const, finishReason: { unified: 'stop' as const, raw: 'stop' }, usage: EMPTY_USAGE },
      ],
    }),
  }
}

describe('WebAIChatRuntime', () => {
  it('aborts a hanging connection test and returns the stable timeout error', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async ({ abortSignal }) =>
        new Promise((_, reject) => {
          abortSignal?.addEventListener('abort', () => reject(abortSignal.reason), { once: true })
        }),
    })
    const runtime = new WebAIChatRuntime(
      createRpc(),
      new WebModelConfigStore(new MemoryKeyValueStore(), webcrypto as unknown as Crypto),
      async () => ({ model }),
      1
    )

    const result = await runtime.testConnection({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      apiKey: 'test-secret',
    })

    assert.equal(result.ok, false)
    assert.equal(result.error?.code, 'TIMEOUT')
  })

  it('reuses the stored API key when testing an edited configuration', async () => {
    const configStore = new WebModelConfigStore(new MemoryKeyValueStore(), webcrypto as unknown as Crypto)
    await configStore.save({ provider: 'deepseek', model: 'deepseek-v4-flash', apiKey: 'saved-secret' })
    let receivedApiKey = ''
    const runtime = new WebAIChatRuntime(createRpc(), configStore, async (_config, apiKey) => {
      receivedApiKey = apiKey
      throw new Error('model factory reached')
    })

    const result = await runtime.testConnection({
      provider: 'openai-compatible',
      baseURL: 'https://example.invalid/v1',
      model: 'updated-model',
      apiKey: '',
    })

    assert.equal(receivedApiKey, 'saved-secret')
    assert.equal(result.ok, false)
  })

  it('preserves provider status from streamed model failures', async () => {
    const configStore = new WebModelConfigStore(new MemoryKeyValueStore(), webcrypto as unknown as Crypto)
    await configStore.save({ provider: 'deepseek', model: 'deepseek-v4-flash', apiKey: 'test-secret' })
    const providerError = Object.assign(new Error('too many requests'), { statusCode: 429 })
    const model = new MockLanguageModelV3({
      doStream: {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'error', error: providerError },
          ],
        }),
      },
    })
    const runtime = new WebAIChatRuntime(createRpc(), configStore, async () => ({ model }))
    const conversation = await runtime.conversations.createConversation('session-1')

    await assert.rejects(
      runtime.run({
        sessionId: 'session-1',
        conversationId: conversation.id,
        locale: 'en',
        userMessage: 'hello',
        onEvent: () => undefined,
      }),
      (error: unknown) =>
        error instanceof WebAIRuntimeError &&
        error.data.code === 'RATE_LIMIT' &&
        error.data.status === 429 &&
        error.data.retryable
    )
  })

  it('retries an unanswered user message without appending it twice', async () => {
    const configStore = new WebModelConfigStore(new MemoryKeyValueStore(), webcrypto as unknown as Crypto)
    await configStore.save({ provider: 'deepseek', model: 'deepseek-v4-flash', apiKey: 'test-secret' })
    const model = new MockLanguageModelV3({
      doStream: [
        {
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              { type: 'error', error: new Error('provider unavailable') },
            ],
          }),
        },
        stream('retry answer'),
      ],
    })
    const runtime = new WebAIChatRuntime(createRpc(), configStore, async () => ({ model }))
    const conversation = await runtime.conversations.createConversation('session-1')

    await assert.rejects(
      runtime.run({
        sessionId: 'session-1',
        conversationId: conversation.id,
        locale: 'en',
        userMessage: 'hello',
        onEvent: () => undefined,
      })
    )
    const [failedUserMessage] = await runtime.conversations.getMessages(conversation.id)
    assert.ok(failedUserMessage)

    const retried = await runtime.retryLast({
      sessionId: 'session-1',
      conversationId: conversation.id,
      locale: 'en',
      onEvent: () => undefined,
    })

    assert.equal(retried.userMessage.id, failedUserMessage.id)
    assert.equal(retried.assistantMessage.content, 'retry answer')
    assert.deepEqual(
      (await runtime.conversations.getMessages(conversation.id)).map((message) => [message.role, message.content]),
      [
        ['user', 'hello'],
        ['assistant', 'retry answer'],
      ]
    )
  })

  it('persists one user turn and supports regenerating the latest assistant reply', async () => {
    const configStore = new WebModelConfigStore(new MemoryKeyValueStore(), webcrypto as unknown as Crypto)
    await configStore.save({ provider: 'deepseek', model: 'deepseek-v4-flash', apiKey: 'test-secret' })
    const model = new MockLanguageModelV3({ doStream: [stream('first answer'), stream('second answer')] })
    const modelFactory = async (): Promise<CreatedWebModel> => ({ model })
    const toolListPayloads: unknown[] = []
    const runtime = new WebAIChatRuntime(createRpc(toolListPayloads), configStore, modelFactory)
    const conversation = await runtime.conversations.createConversation('session-1')

    const first = await runtime.run({
      sessionId: 'session-1',
      conversationId: conversation.id,
      locale: 'en',
      userMessage: 'hello',
      onEvent: () => undefined,
    })
    assert.equal(first.assistantMessage.content, 'first answer')
    assert.deepEqual(toolListPayloads, [{ locale: 'en' }])

    const regenerated = await runtime.regenerateLast({
      sessionId: 'session-1',
      conversationId: conversation.id,
      locale: 'en',
      onEvent: () => undefined,
    })
    assert.equal(regenerated.assistantMessage.content, 'second answer')
    assert.deepEqual(toolListPayloads, [{ locale: 'en' }, { locale: 'en' }])
    assert.deepEqual(
      (await runtime.conversations.getMessages(conversation.id)).map((message) => [message.role, message.content]),
      [
        ['user', 'hello'],
        ['assistant', 'second answer'],
      ]
    )
  })

  it('keeps the previous assistant reply when regeneration fails', async () => {
    const configStore = new WebModelConfigStore(new MemoryKeyValueStore(), webcrypto as unknown as Crypto)
    await configStore.save({ provider: 'deepseek', model: 'deepseek-v4-flash', apiKey: 'test-secret' })
    const model = new MockLanguageModelV3({
      doStream: {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'error', error: new Error('provider unavailable') },
          ],
        }),
      },
    })
    const runtime = new WebAIChatRuntime(createRpc(), configStore, async () => ({ model }))
    const conversation = await runtime.conversations.createConversation('session-1')
    await runtime.conversations.appendMessage({
      conversationId: conversation.id,
      role: 'user',
      content: 'hello',
    })
    await runtime.conversations.appendMessage({
      conversationId: conversation.id,
      role: 'assistant',
      content: 'existing answer',
    })

    await assert.rejects(
      runtime.regenerateLast({
        sessionId: 'session-1',
        conversationId: conversation.id,
        locale: 'en',
        onEvent: () => undefined,
      })
    )
    assert.deepEqual(
      (await runtime.conversations.getMessages(conversation.id)).map((message) => message.content),
      ['hello', 'existing answer']
    )
  })

  it('keeps the previous assistant reply when regeneration is stopped', async () => {
    const configStore = new WebModelConfigStore(new MemoryKeyValueStore(), webcrypto as unknown as Crypto)
    await configStore.save({ provider: 'deepseek', model: 'deepseek-v4-flash', apiKey: 'test-secret' })
    const model = new MockLanguageModelV3({
      doStream: async ({ abortSignal }) => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] })
            controller.enqueue({ type: 'text-start', id: 'partial' })
            controller.enqueue({ type: 'text-delta', id: 'partial', delta: 'partial answer' })
            abortSignal?.addEventListener('abort', () => controller.error(abortSignal.reason), { once: true })
          },
        }),
      }),
    })
    const runtime = new WebAIChatRuntime(createRpc(), configStore, async () => ({ model }))
    const conversation = await runtime.conversations.createConversation('session-1')
    await runtime.conversations.appendMessage({
      conversationId: conversation.id,
      role: 'user',
      content: 'hello',
    })
    const previousReply = await runtime.conversations.appendMessage({
      conversationId: conversation.id,
      role: 'assistant',
      content: 'existing answer',
    })
    let partialReceived!: () => void
    const receivedPartial = new Promise<void>((resolve) => {
      partialReceived = resolve
    })

    const regeneration = runtime.regenerateLast({
      sessionId: 'session-1',
      conversationId: conversation.id,
      locale: 'en',
      onEvent: (event) => {
        if (event.type === 'text-delta') partialReceived()
      },
    })
    await receivedPartial
    assert.equal(runtime.stop(conversation.id), true)
    const result = await regeneration

    assert.equal(result.assistantMessage.id, previousReply.id)
    assert.deepEqual(
      (await runtime.conversations.getMessages(conversation.id)).map((message) => message.content),
      ['hello', 'existing answer']
    )
  })

  it('keeps the previous assistant reply when regeneration is content-filtered', async () => {
    const configStore = new WebModelConfigStore(new MemoryKeyValueStore(), webcrypto as unknown as Crypto)
    await configStore.save({ provider: 'deepseek', model: 'deepseek-v4-flash', apiKey: 'test-secret' })
    const model = new MockLanguageModelV3({
      doStream: {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'finish', finishReason: { unified: 'content-filter', raw: 'content_filter' }, usage: EMPTY_USAGE },
          ],
        }),
      },
    })
    const runtime = new WebAIChatRuntime(createRpc(), configStore, async () => ({ model }))
    const conversation = await runtime.conversations.createConversation('session-1')
    await runtime.conversations.appendMessage({
      conversationId: conversation.id,
      role: 'user',
      content: 'hello',
    })
    const previousReply = await runtime.conversations.appendMessage({
      conversationId: conversation.id,
      role: 'assistant',
      content: 'existing answer',
    })

    const result = await runtime.regenerateLast({
      sessionId: 'session-1',
      conversationId: conversation.id,
      locale: 'en',
      onEvent: () => undefined,
    })

    assert.equal(result.assistantMessage.id, previousReply.id)
    assert.equal(result.finishReason, 'content-filter')
    assert.deepEqual(
      (await runtime.conversations.getMessages(conversation.id)).map((message) => message.content),
      ['hello', 'existing answer']
    )
  })

  it('stops regeneration while conversation history is still loading', async () => {
    const configStore = new WebModelConfigStore(new MemoryKeyValueStore(), webcrypto as unknown as Crypto)
    await configStore.save({ provider: 'deepseek', model: 'deepseek-v4-flash', apiKey: 'test-secret' })
    let releaseMessages!: () => void
    const messageListGate = new Promise<void>((resolve) => {
      releaseMessages = resolve
    })
    let modelFactoryCalls = 0
    const runtime = new WebAIChatRuntime(createRpc([], messageListGate), configStore, async () => {
      modelFactoryCalls += 1
      return { model: new MockLanguageModelV3() }
    })
    const conversation = await runtime.conversations.createConversation('session-1')
    await runtime.conversations.appendMessage({
      conversationId: conversation.id,
      role: 'user',
      content: 'hello',
    })
    await runtime.conversations.appendMessage({
      conversationId: conversation.id,
      role: 'assistant',
      content: 'existing answer',
    })

    const regeneration = runtime.regenerateLast({
      sessionId: 'session-1',
      conversationId: conversation.id,
      locale: 'en',
      onEvent: () => undefined,
    })
    await Promise.resolve()
    assert.equal(runtime.stop(conversation.id), true)
    releaseMessages()

    await assert.rejects(regeneration)
    assert.equal(modelFactoryCalls, 0)
  })

  it('propagates a length-limited finish reason', async () => {
    const configStore = new WebModelConfigStore(new MemoryKeyValueStore(), webcrypto as unknown as Crypto)
    await configStore.save({ provider: 'deepseek', model: 'deepseek-v4-flash', apiKey: 'test-secret' })
    const model = new MockLanguageModelV3({
      doStream: {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: 'text' },
            { type: 'text-delta', id: 'text', delta: 'partial answer' },
            { type: 'text-end', id: 'text' },
            { type: 'finish', finishReason: { unified: 'length', raw: 'length' }, usage: EMPTY_USAGE },
          ],
        }),
      },
    })
    const runtime = new WebAIChatRuntime(createRpc(), configStore, async () => ({ model }))
    const conversation = await runtime.conversations.createConversation('session-1')

    const result = await runtime.run({
      sessionId: 'session-1',
      conversationId: conversation.id,
      locale: 'en',
      userMessage: 'write a long answer',
      onEvent: () => undefined,
    })

    assert.equal(result.finishReason, 'length')
  })

  it('does not regenerate an older reply while the latest user message is unanswered', async () => {
    const configStore = new WebModelConfigStore(new MemoryKeyValueStore(), webcrypto as unknown as Crypto)
    await configStore.save({ provider: 'deepseek', model: 'deepseek-v4-flash', apiKey: 'test-secret' })
    let modelFactoryCalls = 0
    const runtime = new WebAIChatRuntime(createRpc(), configStore, async () => {
      modelFactoryCalls += 1
      return { model: new MockLanguageModelV3() }
    })
    const conversation = await runtime.conversations.createConversation('session-1')
    await runtime.conversations.appendMessage({
      conversationId: conversation.id,
      role: 'user',
      content: 'first question',
    })
    await runtime.conversations.appendMessage({
      conversationId: conversation.id,
      role: 'assistant',
      content: 'first answer',
    })
    await runtime.conversations.appendMessage({
      conversationId: conversation.id,
      role: 'user',
      content: 'unanswered question',
    })

    await assert.rejects(
      runtime.regenerateLast({
        sessionId: 'session-1',
        conversationId: conversation.id,
        locale: 'en',
        onEvent: () => undefined,
      }),
      /latest assistant reply/
    )
    assert.equal(modelFactoryCalls, 0)
    assert.deepEqual(
      (await runtime.conversations.getMessages(conversation.id)).map((message) => message.content),
      ['first question', 'first answer', 'unanswered question']
    )
  })
})
