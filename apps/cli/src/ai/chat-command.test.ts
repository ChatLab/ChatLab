import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { Writable } from 'node:stream'
import type { AIChatManager, DatabaseManager } from '@openchatlab/node-runtime'
import { resolveAIChatTarget, runChatCommand, runChatTurn } from './chat-command'

function createDbManager(sessionIds: string[]): DatabaseManager {
  return {
    listSessionIds: () => sessionIds,
    open: (sessionId: string) => (sessionIds.includes(sessionId) ? {} : null),
  } as unknown as DatabaseManager
}

function createAIChatManager(
  existing: Array<{ id: string; sessionId: string; assistantId?: string }> = []
): AIChatManager {
  const chats = new Map<string, { id: string; sessionId: string; title: string | null; assistantId: string }>(
    existing.map((chat) => [chat.id, { ...chat, title: null, assistantId: chat.assistantId ?? 'general_cn' }])
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
  onChunk?: (text: string) => void

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    const text = String(chunk)
    this.chunks.push(text)
    this.onChunk?.(text)
    callback()
  }

  text(): string {
    return this.chunks.join('')
  }
}

class PromptDrivenReadable extends Readable {
  private nextLines: string[]

  constructor(lines: string[]) {
    super()
    this.nextLines = lines
  }

  _read(): void {
    // Input is pushed when the CLI writes a prompt.
  }

  pushNext(): void {
    const line = this.nextLines.shift()
    if (line === undefined) {
      this.push(null)
      return
    }
    this.push(`${line}\n`)
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

    assert.deepEqual(target, {
      sessionId: 'session-1',
      aiChatId: 'ai-chat-1',
      assistantId: 'general_cn',
      created: false,
    })
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
    let streamedAssistantId: string | undefined
    const result = await runChatTurn(
      { sessionId: 'session-1', question: 'hello', json: true },
      {
        dbManager: createDbManager(['session-1']),
        pathProvider: {} as never,
        aiChatManager,
        stdout,
        createRunAgentStream: () => async (params, onEvent) => {
          streamedAssistantId = params.assistantId
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
    assert.equal(streamedAssistantId, 'general_cn')
    assert.equal(stdout.text(), '')
    assert.deepEqual((aiChatManager as unknown as { __messages: unknown[] }).__messages, [
      { aiChatId: 'ai_chat_1', role: 'user', content: 'hello' },
      { aiChatId: 'ai_chat_1', role: 'assistant', content: 'hi' },
    ])
  })

  it('fails the turn and does not persist messages when the agent stream reports an error', async () => {
    const stdout = new MemoryWritable()
    const aiChatManager = createAIChatManager()

    await assert.rejects(
      () =>
        runChatTurn(
          { sessionId: 'session-1', question: 'hello', json: true },
          {
            dbManager: createDbManager(['session-1']),
            pathProvider: {} as never,
            aiChatManager,
            stdout,
            createRunAgentStream: () => async (_params, onEvent) => {
              onEvent({ type: 'error', error: { name: 'ConfigError', message: 'LLM service not configured' } })
              onEvent({ type: 'done', isFinished: true })
            },
          }
        ),
      /LLM service not configured/
    )

    assert.equal(stdout.text(), '')
    assert.deepEqual((aiChatManager as unknown as { __messages: unknown[] }).__messages, [])
  })

  it('passes the resolved AI chat assistant id into the agent stream', async () => {
    const stdout = new MemoryWritable()
    const aiChatManager = createAIChatManager([
      { id: 'ai-chat-1', sessionId: 'session-1', assistantId: 'custom_assistant' },
    ])
    let streamedAssistantId: string | undefined

    await runChatTurn(
      { aiChatId: 'ai-chat-1', question: 'hello', json: true },
      {
        dbManager: createDbManager(['session-1']),
        pathProvider: {} as never,
        aiChatManager,
        stdout,
        createRunAgentStream: () => async (params, onEvent) => {
          streamedAssistantId = params.assistantId
          onEvent({ type: 'content', content: 'hi' })
          onEvent({ type: 'done', isFinished: true })
        },
      }
    )

    assert.equal(streamedAssistantId, 'custom_assistant')
  })
})

describe('runChatCommand', () => {
  it('keeps interactive mode alive after a single failed turn', async () => {
    const stdout = new MemoryWritable()
    const stderr = new MemoryWritable()
    const stdin = new PromptDrivenReadable(['fail', 'recover', 'exit'])
    const aiChatManager = createAIChatManager()
    stdout.onChunk = (text) => {
      if (text.includes('chatlab> ')) stdin.pushNext()
    }

    const command = runChatCommand(
      { sessionId: 'session-1' },
      {
        dbManager: createDbManager(['session-1']),
        pathProvider: {} as never,
        aiChatManager,
        stdout,
        stderr,
        stdin,
        createRunAgentStream: () => async (params, onEvent) => {
          if (params.userMessage === 'fail') {
            throw new Error('temporary failure')
          }
          onEvent({ type: 'content', content: 'recovered' })
          onEvent({ type: 'done', isFinished: true })
        },
      }
    )
    await command

    assert.match(stderr.text(), /temporary failure/)
    assert.match(stdout.text(), /recovered/)
    assert.deepEqual((aiChatManager as unknown as { __messages: unknown[] }).__messages, [
      { aiChatId: 'ai_chat_2', role: 'user', content: 'recover' },
      { aiChatId: 'ai_chat_2', role: 'assistant', content: 'recovered' },
    ])
  })
})
