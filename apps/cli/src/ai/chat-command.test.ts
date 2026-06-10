import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { Writable } from 'node:stream'
import type { AIChatManager, ContentBlock, DatabaseManager, TokenUsageData } from '@openchatlab/node-runtime'
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
  const messages: Array<{
    aiChatId: string
    role: string
    content: string
    contentBlocks?: ContentBlock[]
    tokenUsage?: TokenUsageData
  }> = []

  return {
    getAIChat: (aiChatId: string) => chats.get(aiChatId) ?? null,
    createAIChat: (sessionId: string, title: string | undefined, assistantId: string) => {
      const id = `ai_chat_${chats.size + 1}`
      const chat = { id, sessionId, title: title ?? null, assistantId }
      chats.set(id, chat)
      return chat
    },
    addMessage: (
      aiChatId: string,
      role: string,
      content: string,
      _dataKeywords?: string[],
      _dataMessageCount?: number,
      contentBlocks?: ContentBlock[],
      tokenUsage?: TokenUsageData
    ) => {
      messages.push({
        aiChatId,
        role,
        content,
        ...(contentBlocks ? { contentBlocks } : {}),
        ...(tokenUsage ? { tokenUsage } : {}),
      })
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
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 },
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
      {
        aiChatId: 'ai_chat_1',
        role: 'assistant',
        content: 'hi',
        tokenUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
    ])
  })

  it('can include all agent events and persist plan content blocks', async () => {
    const stdout = new MemoryWritable()
    const aiChatManager = createAIChatManager()

    const result = await runChatTurn(
      { sessionId: 'session-1', question: '分析过去一年话题趋势', json: true, includeEvents: true },
      {
        dbManager: createDbManager(['session-1']),
        pathProvider: {} as never,
        aiChatManager,
        stdout,
        createRunAgentStream: () => async (_params, onEvent) => {
          onEvent({
            type: 'route',
            routeDecision: {
              route: 'planned_execution',
              confidence: 0.91,
              reason: 'Complex long-range trend analysis.',
              source: 'rule',
            },
          })
          onEvent({ type: 'plan_delta', planDelta: '年度话题趋势\n' })
          onEvent({ type: 'plan_delta', planDelta: '1. 按季度检索\n' })
          onEvent({
            type: 'plan',
            plan: {
              type: 'plan',
              version: 1,
              status: 'created',
              plan: {
                version: 1,
                title: '年度话题趋势',
                route: 'planned_execution',
                intent: 'trend',
                steps: [{ goal: '按季度检索', suggestedTools: ['search_messages'], evidenceNeeded: '季度证据' }],
                successCriteria: ['覆盖至少三个季度'],
              },
            },
          })
          onEvent({ type: 'content', content: '年度趋势如下。' })
          onEvent({
            type: 'done',
            isFinished: true,
            usage: { promptTokens: 3, completionTokens: 5, totalTokens: 8, cacheReadTokens: 0, cacheWriteTokens: 0 },
          })
        },
      }
    )

    assert.equal(result.answer, '年度趋势如下。')
    assert.equal(result.events?.length, 6)
    assert.equal(result.events?.[0]?.type, 'route')
    assert.equal(result.events?.[0]?.routeDecision?.route, 'planned_execution')
    assert.equal(result.events?.[1]?.type, 'plan_delta')
    assert.equal(result.events?.[2]?.type, 'plan_delta')
    assert.equal(result.events?.[3]?.type, 'plan')
    const firstBlock = result.contentBlocks?.[0]
    assert.equal(firstBlock?.type, 'plan')
    if (firstBlock?.type === 'plan') {
      assert.equal(firstBlock.status, 'done')
      assert.equal(firstBlock.displayText, '年度话题趋势\n1. 按季度检索')
    }
    assert.deepEqual((aiChatManager as unknown as { __messages: unknown[] }).__messages, [
      { aiChatId: 'ai_chat_1', role: 'user', content: '分析过去一年话题趋势' },
      {
        aiChatId: 'ai_chat_1',
        role: 'assistant',
        content: '年度趋势如下。',
        contentBlocks: result.contentBlocks,
        tokenUsage: { promptTokens: 3, completionTokens: 5, totalTokens: 8, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
    ])
  })

  it('drops streamed plan drafts when planner validation is skipped', async () => {
    const stdout = new MemoryWritable()
    const aiChatManager = createAIChatManager()

    const result = await runChatTurn(
      { sessionId: 'session-1', question: '分析过去一年话题趋势', json: true, includeEvents: true },
      {
        dbManager: createDbManager(['session-1']),
        pathProvider: {} as never,
        aiChatManager,
        stdout,
        createRunAgentStream: () => async (_params, onEvent) => {
          onEvent({ type: 'plan_delta', planDelta: '无法校验的计划草稿\n' })
          onEvent({ type: 'plan_skipped' })
          onEvent({ type: 'content', content: '直接给出分析。' })
          onEvent({ type: 'done', isFinished: true })
        },
      }
    )

    assert.equal(result.events?.[0]?.type, 'plan_delta')
    assert.equal(result.events?.[1]?.type, 'plan_skipped')
    assert.deepEqual(
      result.contentBlocks?.map((block) => block.type),
      ['text']
    )
  })

  it('persists streamed thinking and answer text blocks for full CLI replay', async () => {
    const stdout = new MemoryWritable()
    const aiChatManager = createAIChatManager()

    const result = await runChatTurn(
      { sessionId: 'session-1', question: '分析过去一年话题趋势', json: true, includeEvents: true },
      {
        dbManager: createDbManager(['session-1']),
        pathProvider: {} as never,
        aiChatManager,
        stdout,
        createRunAgentStream: () => async (_params, onEvent) => {
          onEvent({
            type: 'plan',
            plan: {
              type: 'plan',
              version: 1,
              status: 'created',
              plan: {
                version: 1,
                title: '年度话题趋势',
                route: 'planned_execution',
                intent: 'trend',
                steps: [{ goal: '按季度检索', suggestedTools: ['search_messages'], evidenceNeeded: '季度证据' }],
                successCriteria: ['覆盖至少三个季度'],
              },
            },
          })
          onEvent({ type: 'think', thinkTag: 'thinking', content: '先理解问题，' })
          onEvent({ type: 'think', thinkTag: 'thinking', content: '再整理证据。' })
          onEvent({ type: 'think', thinkTag: 'thinking', content: '', thinkDurationMs: 1200 })
          onEvent({ type: 'content', content: '年度趋势如下。' })
          onEvent({
            type: 'done',
            isFinished: true,
            usage: { promptTokens: 3, completionTokens: 5, totalTokens: 8, cacheReadTokens: 0, cacheWriteTokens: 0 },
          })
        },
      }
    )

    assert.equal(result.answer, '年度趋势如下。')
    assert.equal(result.events?.filter((event) => event.type === 'think').length, 3)
    assert.deepEqual(
      result.contentBlocks?.map((block) => block.type),
      ['plan', 'think', 'text']
    )
    assert.equal(result.contentBlocks?.[0]?.type, 'plan')
    assert.equal(result.contentBlocks?.[0]?.status, 'done')
    assert.deepEqual(result.contentBlocks?.[1], {
      type: 'think',
      tag: 'thinking',
      text: '先理解问题，再整理证据。',
      durationMs: 1200,
    })
    assert.deepEqual(result.contentBlocks?.[2], {
      type: 'text',
      text: '年度趋势如下。',
    })
    assert.deepEqual((aiChatManager as unknown as { __messages: unknown[] }).__messages, [
      { aiChatId: 'ai_chat_1', role: 'user', content: '分析过去一年话题趋势' },
      {
        aiChatId: 'ai_chat_1',
        role: 'assistant',
        content: '年度趋势如下。',
        contentBlocks: result.contentBlocks,
        tokenUsage: { promptTokens: 3, completionTokens: 5, totalTokens: 8, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
    ])
  })

  it('persists render_chart results as chart content blocks for CLI replay', async () => {
    const stdout = new MemoryWritable()
    const aiChatManager = createAIChatManager()
    const chart = {
      version: 1,
      spec: {
        version: 1,
        type: 'bar',
        title: '季度消息量趋势',
        encoding: { x: 'quarter', y: 'count' },
      },
      dataset: {
        columns: [
          { name: 'quarter', type: 'category' },
          { name: 'count', type: 'integer' },
        ],
        rows: [
          { quarter: '2025-Q4', count: 1607 },
          { quarter: '2026-Q1', count: 4284 },
        ],
      },
      data: {
        labels: ['2025-Q4', '2026-Q1'],
        values: [1607, 4284],
      },
      rowCount: 2,
    } as const

    const result = await runChatTurn(
      { sessionId: 'session-1', question: '分析季度消息量变化趋势', json: true, includeEvents: true },
      {
        dbManager: createDbManager(['session-1']),
        pathProvider: {} as never,
        aiChatManager,
        stdout,
        createRunAgentStream: () => async (_params, onEvent) => {
          onEvent({
            type: 'plan',
            plan: {
              type: 'plan',
              version: 1,
              status: 'created',
              plan: {
                version: 1,
                title: '季度消息量趋势',
                route: 'planned_execution',
                intent: 'trend',
                steps: [
                  { goal: '生成趋势图', suggestedTools: ['get_schema', 'render_chart'], evidenceNeeded: '季度数据' },
                ],
                successCriteria: ['展示趋势'],
              },
            },
          })
          onEvent({ type: 'tool_result', toolName: 'render_chart', toolResult: { details: { chart } } })
          onEvent({ type: 'content', content: '2026-Q1 是峰值。' })
          onEvent({
            type: 'done',
            isFinished: true,
            usage: { promptTokens: 3, completionTokens: 5, totalTokens: 8, cacheReadTokens: 0, cacheWriteTokens: 0 },
          })
        },
      }
    )

    assert.deepEqual(
      result.contentBlocks?.map((block) => block.type),
      ['plan', 'chart', 'text']
    )
    assert.equal(result.contentBlocks?.[1]?.type, 'chart')
    assert.deepEqual(result.contentBlocks?.[1]?.chart.dataset.rows, [])
    assert.deepEqual(result.contentBlocks?.[1]?.chart.data, chart.data)
    assert.deepEqual((aiChatManager as unknown as { __messages: unknown[] }).__messages.at(-1), {
      aiChatId: 'ai_chat_1',
      role: 'assistant',
      content: '2026-Q1 是峰值。',
      contentBlocks: result.contentBlocks,
      tokenUsage: { promptTokens: 3, completionTokens: 5, totalTokens: 8, cacheReadTokens: 0, cacheWriteTokens: 0 },
    })
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
    let streamedEnableAutoSkill: boolean | undefined

    await runChatTurn(
      { aiChatId: 'ai-chat-1', question: 'hello', json: true },
      {
        dbManager: createDbManager(['session-1']),
        pathProvider: {} as never,
        aiChatManager,
        stdout,
        createRunAgentStream: () => async (params, onEvent) => {
          streamedAssistantId = params.assistantId
          streamedEnableAutoSkill = params.enableAutoSkill
          onEvent({ type: 'content', content: 'hi' })
          onEvent({ type: 'done', isFinished: true })
        },
      }
    )

    assert.equal(streamedAssistantId, 'custom_assistant')
    assert.equal(streamedEnableAutoSkill, true)
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
