import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { MockLanguageModelV3, simulateReadableStream } from 'ai/test'

import { runAgent } from './runtime'
import type {
  AgentStreamEvent,
  AppendRuntimeMessageInput,
  ConversationRepository,
  RuntimeConversation,
  RuntimeMessage,
  RuntimeToolDefinition,
  RuntimeToolResult,
  ToolExecutionContext,
  ToolExecutor,
} from './types'

const EMPTY_USAGE = {
  inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 4, text: 4, reasoning: 0 },
}

class MemoryRepository implements ConversationRepository {
  readonly messages: RuntimeMessage[] = []
  readonly conversation: RuntimeConversation = {
    id: 'conversation-1',
    sessionId: 'session-1',
    title: null,
    createdAt: 1,
    updatedAt: 1,
  }

  async getConversation(id: string): Promise<RuntimeConversation | null> {
    return id === this.conversation.id ? this.conversation : null
  }

  async getMessages(conversationId: string): Promise<RuntimeMessage[]> {
    return this.messages.filter((message) => message.conversationId === conversationId)
  }

  async appendMessage(input: AppendRuntimeMessageInput): Promise<RuntimeMessage> {
    const message: RuntimeMessage = {
      id: input.id ?? `message-${this.messages.length + 1}`,
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      createdAt: input.createdAt ?? Date.now(),
      blocks: input.blocks,
      usage: input.usage,
    }
    this.messages.push(message)
    return message
  }

  async updateMessage(id: string, patch: Pick<RuntimeMessage, 'content' | 'blocks' | 'usage'>): Promise<void> {
    const message = this.messages.find((item) => item.id === id)
    if (message) Object.assign(message, patch)
  }

  async replaceSummary(
    conversationId: string,
    input: { content: string; boundaryMessageId: string }
  ): Promise<RuntimeMessage> {
    const current = this.messages.find((message) => message.role === 'summary')
    if (current) {
      current.content = input.content
      return current
    }
    return this.appendMessage({ conversationId, role: 'summary', content: input.content })
  }
}

class FakeToolExecutor implements ToolExecutor {
  readonly calls: Array<{ name: string; input: unknown; context: ToolExecutionContext }> = []

  listTools(): RuntimeToolDefinition[] {
    return [
      {
        name: 'get_chat_overview',
        description: 'Get a safe local chat overview.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      },
    ]
  }

  async execute(
    name: string,
    input: unknown,
    context: ToolExecutionContext,
    _signal: AbortSignal
  ): Promise<RuntimeToolResult> {
    this.calls.push({ name, input, context })
    return {
      content: '{"totalMessages":128}',
      data: { totalMessages: 128 },
      chart: { spec: { type: 'bar', title: 'Messages' }, data: [] },
    }
  }
}

describe('runAgent', () => {
  it('streams text, persists the assistant message, and emits stable events', async () => {
    const model = new MockLanguageModelV3({
      doStream: {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: 'text-1' },
            { type: 'text-delta', id: 'text-1', delta: '测试' },
            { type: 'text-delta', id: 'text-1', delta: '成功' },
            { type: 'text-end', id: 'text-1' },
            { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: EMPTY_USAGE },
          ],
        }),
      },
    })
    const repository = new MemoryRepository()
    const events: AgentStreamEvent[] = []

    const result = await runAgent({
      conversationId: 'conversation-1',
      sessionId: 'session-1',
      systemPrompt: 'You are a test assistant.',
      userMessage: 'hello',
      model: { model, contextWindow: 128_000 },
      repository,
      tools: new FakeToolExecutor(),
      signal: new AbortController().signal,
      onEvent: (event) => events.push(event),
    })

    assert.equal(result.message.content, '测试成功')
    assert.equal(result.finishReason, 'stop')
    assert.equal(repository.messages.at(-1)?.content, '测试成功')
    assert.deepEqual(
      events.filter((event) => event.type === 'text-delta').map((event) => event.delta),
      ['测试', '成功']
    )
    assert.equal(events.at(0)?.type, 'start')
    assert.equal(events.at(-1)?.type, 'finish')
  })

  it('executes a tool with the bound session and continues to a final answer', async () => {
    const model = new MockLanguageModelV3({
      doStream: [
        {
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              {
                type: 'tool-call',
                toolCallId: 'call-1',
                toolName: 'get_chat_overview',
                input: '{}',
              },
              { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage: EMPTY_USAGE },
            ],
          }),
        },
        {
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              { type: 'text-start', id: 'text-2' },
              { type: 'text-delta', id: 'text-2', delta: '共有 128 条消息。' },
              { type: 'text-end', id: 'text-2' },
              { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: EMPTY_USAGE },
            ],
          }),
        },
      ],
    })
    const tools = new FakeToolExecutor()
    const events: AgentStreamEvent[] = []

    const result = await runAgent({
      conversationId: 'conversation-1',
      sessionId: 'session-1',
      systemPrompt: 'Always use the local tool.',
      userMessage: 'How many messages?',
      model: { model, contextWindow: 128_000 },
      repository: new MemoryRepository(),
      tools,
      signal: new AbortController().signal,
      onEvent: (event) => events.push(event),
    })

    assert.equal(result.message.content, '共有 128 条消息。')
    assert.deepEqual(result.toolsUsed, ['get_chat_overview'])
    assert.equal(tools.calls[0]?.context.sessionId, 'session-1')
    assert.equal(
      result.message.blocks?.some((block) => block.type === 'chart'),
      true
    )
    assert.equal(
      events.some((event) => event.type === 'tool-start'),
      true
    )
    assert.equal(
      events.some((event) => event.type === 'tool-result'),
      true
    )
    assert.equal(
      events.some((event) => event.type === 'chart'),
      true
    )
  })
})
