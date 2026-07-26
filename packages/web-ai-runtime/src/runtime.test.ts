import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { describe, it } from 'node:test'

import type { RuntimeConversation, RuntimeMessage } from '@openchatlab/ai-runtime'
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test'

import { WebModelConfigStore, type BrowserKeyValueStore } from './model-config-store'
import type { CreatedWebModel } from './provider-factory'
import type { WebRuntimeRpcPort } from './rpc-adapters'
import { WebAIChatRuntime } from './runtime'

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

function createRpc(): WebRuntimeRpcPort {
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
  it('persists one user turn and supports regenerating the latest assistant reply', async () => {
    const configStore = new WebModelConfigStore(new MemoryKeyValueStore(), webcrypto as unknown as Crypto)
    await configStore.save({ provider: 'deepseek', model: 'deepseek-v4-flash', apiKey: 'test-secret' })
    const model = new MockLanguageModelV3({ doStream: [stream('first answer'), stream('second answer')] })
    const modelFactory = async (): Promise<CreatedWebModel> => ({ model, contextWindow: 128_000 })
    const runtime = new WebAIChatRuntime(createRpc(), configStore, modelFactory)
    const conversation = await runtime.conversations.createConversation('session-1')

    const first = await runtime.run({
      sessionId: 'session-1',
      conversationId: conversation.id,
      locale: 'en',
      userMessage: 'hello',
      onEvent: () => undefined,
    })
    assert.equal(first.assistantMessage.content, 'first answer')

    const regenerated = await runtime.regenerateLast({
      sessionId: 'session-1',
      conversationId: conversation.id,
      locale: 'en',
      onEvent: () => undefined,
    })
    assert.equal(regenerated.assistantMessage.content, 'second answer')
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
    const runtime = new WebAIChatRuntime(createRpc(), configStore, async () => ({ model, contextWindow: 128_000 }))
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
})
