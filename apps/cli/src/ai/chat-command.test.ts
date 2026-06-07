import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Writable } from 'node:stream'
import type { AIChatManager, DatabaseManager } from '@openchatlab/node-runtime'
import { resolveAIChatTarget, runChatTurn } from './chat-command'

function createDbManager(sessionIds: string[]): DatabaseManager {
  return {
    listSessionIds: () => sessionIds,
    open: (sessionId: string) => (sessionIds.includes(sessionId) ? {} : null),
  } as unknown as DatabaseManager
}

function createAIChatManager(existing: Array<{ id: string; sessionId: string }> = []): AIChatManager {
  const chats = new Map<string, { id: string; sessionId: string; title: string | null; assistantId: string }>(
    existing.map((chat) => [chat.id, { ...chat, title: null, assistantId: 'general_cn' }])
  )
  const messages: Array<{ aiChatId: string; role: string; content: string }> = []

  return {
    getAIChat: (aiChatId: string) => chats.get(aiChatId) ?? null,
    createAIChat: (sessionId: string, title: string | undefined, assistantId: string) => {
      const id = `ai_chat_${chats.size + 1}`
      const chat = { id, sessionId, title: title ?? null, assistantId }
      chats.set(id, chat)
      return chat
    },
    addMessage: (aiChatId: string, role: string, content: string) => {
      messages.push({ aiChatId, role, content })
      return { id: `msg_${messages.length}`, aiChatId, role, content, timestamp: 1 }
    },
    __messages: messages,
  } as unknown as AIChatManager
}

class MemoryWritable extends Writable {
  chunks: string[] = []

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(String(chunk))
    callback()
  }

  text(): string {
    return this.chunks.join('')
  }
}

describe('resolveAIChatTarget', () => {
  it('creates a new AI chat for an explicit session id', () => {
    const target = resolveAIChatTarget(
      { sessionId: 'session-1', question: 'hello' },
      { dbManager: createDbManager(['session-1']), aiChatManager: createAIChatManager() }
    )

    assert.equal(target.sessionId, 'session-1')
    assert.equal(target.aiChatId, 'ai_chat_1')
    assert.equal(target.created, true)
  })

  it('recovers session id from a globally unique aiChatId', () => {
    const target = resolveAIChatTarget(
      { aiChatId: 'ai-chat-1' },
      {
        dbManager: createDbManager(['session-1']),
        aiChatManager: createAIChatManager([{ id: 'ai-chat-1', sessionId: 'session-1' }]),
      }
    )

    assert.deepEqual(target, { sessionId: 'session-1', aiChatId: 'ai-chat-1', created: false })
  })

  it('rejects mismatched explicit session id and aiChatId', () => {
    assert.throws(
      () =>
        resolveAIChatTarget(
          { sessionId: 'session-2', aiChatId: 'ai-chat-1' },
          {
            dbManager: createDbManager(['session-1', 'session-2']),
            aiChatManager: createAIChatManager([{ id: 'ai-chat-1', sessionId: 'session-1' }]),
          }
        ),
      /belongs to session session-1/
    )
  })
})

describe('runChatTurn', () => {
  it('collects streamed answer and persists user and assistant messages', async () => {
    const stdout = new MemoryWritable()
    const aiChatManager = createAIChatManager()
    const result = await runChatTurn(
      { sessionId: 'session-1', question: 'hello', json: true },
      {
        dbManager: createDbManager(['session-1']),
        pathProvider: {} as never,
        aiChatManager,
        stdout,
        createRunAgentStream: () => async (_params, onEvent) => {
          onEvent({ type: 'content', content: 'hi' })
          onEvent({
            type: 'done',
            isFinished: true,
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          })
        },
      }
    )

    assert.equal(result.sessionId, 'session-1')
    assert.equal(result.aiChatId, 'ai_chat_1')
    assert.equal(result.answer, 'hi')
    assert.equal(result.usage.tokenUsage?.totalTokens, 2)
    assert.equal(stdout.text(), '')
    assert.deepEqual((aiChatManager as unknown as { __messages: unknown[] }).__messages, [
      { aiChatId: 'ai_chat_1', role: 'user', content: 'hello' },
      { aiChatId: 'ai_chat_1', role: 'assistant', content: 'hi' },
    ])
  })
})
