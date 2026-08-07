import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { MockLanguageModelV3, simulateReadableStream } from 'ai/test'

import { runAgent } from './runtime'
import type {
  AgentStreamEvent,
  AppendRuntimeMessageInput,
  ConversationRepository,
  RuntimeConversation,
  RuntimeContextSummary,
  RuntimeMessage,
  RuntimeModel,
  SaveRuntimeContextSummaryInput,
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
  contextSummary: RuntimeContextSummary | null = null
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

  async getContextSummary(conversationId: string): Promise<RuntimeContextSummary | null> {
    return this.contextSummary?.conversationId === conversationId ? this.contextSummary : null
  }

  async saveContextSummary(input: SaveRuntimeContextSummaryInput): Promise<RuntimeContextSummary> {
    this.contextSummary = { ...input, updatedAt: Date.now() }
    return this.contextSummary
  }
}

class FakeToolExecutor implements ToolExecutor {
  readonly calls: Array<{ name: string; input: unknown; context: ToolExecutionContext }> = []
  result: RuntimeToolResult = {
    content: '{"totalMessages":128}',
    data: { totalMessages: 128, modelPrivateMarker: 'data-must-not-reach-model' },
    evidence: { modelPrivateMarker: 'evidence-must-not-reach-model' },
  }

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
    return this.result
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
      model: { model },
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
      model: { model },
      repository: new MemoryRepository(),
      tools,
      signal: new AbortController().signal,
      onEvent: (event) => events.push(event),
    })

    assert.equal(result.message.content, '共有 128 条消息。')
    assert.deepEqual(result.toolsUsed, ['get_chat_overview'])
    assert.equal(tools.calls[0]?.context.sessionId, 'session-1')
    assert.equal(
      events.some((event) => event.type === 'tool-start'),
      true
    )
    assert.equal(
      events.some((event) => event.type === 'tool-result'),
      true
    )
    const secondModelPrompt = JSON.stringify(model.doStreamCalls[1]?.prompt)
    assert.match(secondModelPrompt, /totalMessages/)
    assert.doesNotMatch(secondModelPrompt, /data-must-not-reach-model/)
    assert.doesNotMatch(secondModelPrompt, /evidence-must-not-reach-model/)
    const toolBlock = result.message.blocks?.find((block) => block.type === 'tool')
    assert.ok(toolBlock)
    assert.doesNotMatch(JSON.stringify(toolBlock.result), /data-must-not-reach-model/)
    assert.doesNotMatch(JSON.stringify(toolBlock.result), /evidence-must-not-reach-model/)
    assert.match(JSON.stringify(result.message.blocks), /evidence-must-not-reach-model/)
  })

  it('marks handled tool failures as errors without interrupting the model', async () => {
    const model = new MockLanguageModelV3({
      doStream: [
        {
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              { type: 'tool-call', toolCallId: 'call-1', toolName: 'get_chat_overview', input: '{}' },
              { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage: EMPTY_USAGE },
            ],
          }),
        },
        {
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              { type: 'text-start', id: 'text-1' },
              { type: 'text-delta', id: 'text-1', delta: '请调整查询后重试。' },
              { type: 'text-end', id: 'text-1' },
              { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: EMPTY_USAGE },
            ],
          }),
        },
      ],
    })
    const tools = new FakeToolExecutor()
    tools.result = { content: 'Error: At least one keyword is required', isError: true }
    const events: AgentStreamEvent[] = []

    const result = await runAgent({
      conversationId: 'conversation-1',
      sessionId: 'session-1',
      systemPrompt: 'Use the local tool.',
      userMessage: 'Search the chat.',
      model: { model },
      repository: new MemoryRepository(),
      tools,
      signal: new AbortController().signal,
      onEvent: (event) => events.push(event),
    })

    assert.equal(result.message.content, '请调整查询后重试。')
    assert.equal(events.find((event) => event.type === 'tool-result')?.isError, true)
    assert.equal(result.message.blocks?.find((block) => block.type === 'tool')?.isError, true)
  })

  it('persists text, tools, and later text in streamed order', async () => {
    const model = new MockLanguageModelV3({
      doStream: [
        {
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              { type: 'text-start', id: 'text-1' },
              { type: 'text-delta', id: 'text-1', delta: '先确认数据。' },
              { type: 'text-end', id: 'text-1' },
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
              { type: 'text-delta', id: 'text-2', delta: '最终结论。' },
              { type: 'text-end', id: 'text-2' },
              { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: EMPTY_USAGE },
            ],
          }),
        },
      ],
    })

    const result = await runAgent({
      conversationId: 'conversation-1',
      sessionId: 'session-1',
      systemPrompt: 'Use the local tool.',
      userMessage: 'Analyze this chat.',
      model: { model },
      repository: new MemoryRepository(),
      tools: new FakeToolExecutor(),
      signal: new AbortController().signal,
      onEvent: () => undefined,
    })

    assert.deepEqual(
      result.message.blocks?.map((block) => block.type),
      ['text', 'tool', 'evidence', 'text']
    )
    assert.equal(result.message.blocks?.[0]?.type === 'text' ? result.message.blocks[0].text : null, '先确认数据。')
    assert.equal(result.message.blocks?.[3]?.type === 'text' ? result.message.blocks[3].text : null, '最终结论。')
  })

  it('automatically compresses oversized browser history without deleting original messages', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: {
        content: [{ type: 'text', text: 'COMPRESSED CONTEXT' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: EMPTY_USAGE,
        warnings: [],
      },
      doStream: {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: 'text-1' },
            { type: 'text-delta', id: 'text-1', delta: '继续回答' },
            { type: 'text-end', id: 'text-1' },
            { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: EMPTY_USAGE },
          ],
        }),
      },
    })
    const repository = new MemoryRepository()
    for (let index = 0; index < 8; index++) {
      await repository.appendMessage({
        conversationId: 'conversation-1',
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `old-marker-${index} ${'history '.repeat(20)}`,
        createdAt: index + 1,
      })
    }
    const originalMessageIds = repository.messages.map((message) => message.id)
    const events: AgentStreamEvent[] = []

    await runAgent({
      conversationId: 'conversation-1',
      sessionId: 'session-1',
      systemPrompt: 'You are a test assistant.',
      userMessage: 'continue',
      model: { model, contextWindow: 240 } as RuntimeModel,
      repository,
      tools: new FakeToolExecutor(),
      signal: new AbortController().signal,
      onEvent: (event) => events.push(event),
    })

    assert.equal(repository.contextSummary?.content, 'COMPRESSED CONTEXT')
    assert.ok(repository.contextSummary?.compressedMessageCount)
    assert.deepEqual(
      repository.messages.slice(0, originalMessageIds.length).map((message) => message.id),
      originalMessageIds
    )
    const modelPrompt = JSON.stringify(model.doStreamCalls[0]?.prompt)
    assert.match(modelPrompt, /COMPRESSED CONTEXT/)
    assert.doesNotMatch(modelPrompt, /old-marker-0/)
    assert.equal(
      events.some((event) => event.type === 'context-compression-start'),
      true
    )
    assert.equal(
      events.some((event) => event.type === 'context-compression-finish'),
      true
    )
  })

  it('merges an existing browser summary into the next automatic compression', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: {
        content: [{ type: 'text', text: 'UPDATED SUMMARY' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: EMPTY_USAGE,
        warnings: [],
      },
      doStream: {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: 'text-1' },
            { type: 'text-delta', id: 'text-1', delta: '继续回答' },
            { type: 'text-end', id: 'text-1' },
            { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: EMPTY_USAGE },
          ],
        }),
      },
    })
    const repository = new MemoryRepository()
    const boundary = await repository.appendMessage({
      conversationId: 'conversation-1',
      role: 'assistant',
      content: 'already summarized',
      createdAt: 1,
    })
    repository.contextSummary = {
      conversationId: 'conversation-1',
      content: 'PREVIOUS SUMMARY',
      boundaryMessageId: boundary.id,
      compressedMessageCount: 4,
      updatedAt: 2,
    }
    for (let index = 0; index < 8; index++) {
      await repository.appendMessage({
        conversationId: 'conversation-1',
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `new-marker-${index} ${'history '.repeat(20)}`,
        createdAt: index + 3,
      })
    }

    await runAgent({
      conversationId: 'conversation-1',
      sessionId: 'session-1',
      systemPrompt: 'You are a test assistant.',
      userMessage: 'continue',
      model: { model, contextWindow: 240 },
      repository,
      tools: new FakeToolExecutor(),
      signal: new AbortController().signal,
      onEvent: () => undefined,
    })

    const compressionPrompt = JSON.stringify(model.doGenerateCalls[0]?.prompt)
    assert.match(compressionPrompt, /PREVIOUS SUMMARY/)
    assert.match(compressionPrompt, /new-marker-0/)
    assert.equal(repository.contextSummary?.content, 'UPDATED SUMMARY')
    assert.ok((repository.contextSummary?.compressedMessageCount ?? 0) > 4)
    const modelPrompt = JSON.stringify(model.doStreamCalls[0]?.prompt)
    assert.match(modelPrompt, /UPDATED SUMMARY/)
    assert.doesNotMatch(modelPrompt, /PREVIOUS SUMMARY/)
  })

  it('continues with the original browser history when automatic compression fails', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        throw new Error('compression failed')
      },
      doStream: {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: 'text-1' },
            { type: 'text-delta', id: 'text-1', delta: 'fallback answer' },
            { type: 'text-end', id: 'text-1' },
            { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: EMPTY_USAGE },
          ],
        }),
      },
    })
    const repository = new MemoryRepository()
    for (let index = 0; index < 8; index++) {
      await repository.appendMessage({
        conversationId: 'conversation-1',
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `fallback-marker-${index} ${'history '.repeat(20)}`,
        createdAt: index + 1,
      })
    }
    const events: AgentStreamEvent[] = []

    const result = await runAgent({
      conversationId: 'conversation-1',
      sessionId: 'session-1',
      systemPrompt: 'You are a test assistant.',
      userMessage: 'continue',
      model: { model, contextWindow: 240 },
      repository,
      tools: new FakeToolExecutor(),
      signal: new AbortController().signal,
      onEvent: (event) => events.push(event),
    })

    assert.equal(result.message.content, 'fallback answer')
    assert.equal(repository.contextSummary, null)
    assert.match(JSON.stringify(model.doStreamCalls[0]?.prompt), /fallback-marker-0/)
    assert.deepEqual(
      events.find((event) => event.type === 'context-compression-finish'),
      { type: 'context-compression-finish', compressed: false }
    )
  })
})
