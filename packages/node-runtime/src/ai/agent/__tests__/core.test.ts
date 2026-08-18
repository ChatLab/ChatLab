import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AgentTool, StreamFn } from '@earendil-works/pi-agent-core'
import {
  createAssistantMessageEventStream,
  Type,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
  type ToolCall,
} from '@earendil-works/pi-ai'

import { runAgentCore } from '../core'
import type { AgentCoreEvent, AgentCoreOptions } from '../types'

const model: Model<'openai-completions'> = {
  id: 'test-model',
  name: 'Test Model',
  api: 'openai-completions',
  provider: 'test-provider',
  baseUrl: 'http://localhost.invalid/v1',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 8_192,
}

const emptyUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

function assistantMessage(
  content: AssistantMessage['content'],
  options: { stopReason?: AssistantMessage['stopReason']; errorMessage?: string } = {}
): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyUsage,
    stopReason: options.stopReason ?? 'stop',
    errorMessage: options.errorMessage,
    timestamp: Date.now(),
  }
}

function emitMessage(stream: AssistantMessageEventStream, message: AssistantMessage): void {
  const partial: AssistantMessage = { ...message, content: [] }
  stream.push({ type: 'start', partial: { ...partial } })

  message.content.forEach((block, contentIndex) => {
    if (block.type === 'text') {
      partial.content = [...partial.content, { type: 'text', text: block.text }]
      stream.push({ type: 'text_start', contentIndex, partial: { ...partial } })
      stream.push({ type: 'text_delta', contentIndex, delta: block.text, partial: { ...partial } })
      stream.push({ type: 'text_end', contentIndex, content: block.text, partial: { ...partial } })
      return
    }

    if (block.type === 'thinking') {
      partial.content = [...partial.content, { type: 'thinking', thinking: block.thinking }]
      stream.push({ type: 'thinking_start', contentIndex, partial: { ...partial } })
      stream.push({ type: 'thinking_delta', contentIndex, delta: block.thinking, partial: { ...partial } })
      stream.push({ type: 'thinking_end', contentIndex, content: block.thinking, partial: { ...partial } })
      return
    }

    partial.content = [...partial.content, block]
    stream.push({ type: 'toolcall_start', contentIndex, partial: { ...partial } })
    stream.push({
      type: 'toolcall_delta',
      contentIndex,
      delta: JSON.stringify(block.arguments),
      partial: { ...partial },
    })
    stream.push({ type: 'toolcall_end', contentIndex, toolCall: block, partial: { ...partial } })
  })

  if (message.stopReason === 'error' || message.stopReason === 'aborted') {
    stream.push({ type: 'error', reason: message.stopReason, error: message })
  } else {
    stream.push({ type: 'done', reason: message.stopReason, message })
  }
  stream.end(message)
}

type ResponseStep =
  | AssistantMessage
  | ((context: Context, options: SimpleStreamOptions | undefined) => AssistantMessage | Promise<AssistantMessage>)

function createScriptedStream(steps: ResponseStep[]): StreamFn {
  let callIndex = 0
  return (_requestModel, context, options) => {
    const stream = createAssistantMessageEventStream()
    const step = steps[callIndex++]

    queueMicrotask(async () => {
      if (!step) {
        const error = assistantMessage([], { stopReason: 'error', errorMessage: 'Missing scripted response' })
        emitMessage(stream, error)
        return
      }

      const message = typeof step === 'function' ? await step(context, options) : step
      emitMessage(stream, message)
    })

    return stream
  }
}

function createTool(name: string, execute: AgentTool['execute']): AgentTool {
  return {
    name,
    label: name,
    description: name,
    parameters: Type.Object({}),
    execute,
  }
}

function createOptions(overrides: Partial<AgentCoreOptions> = {}): AgentCoreOptions {
  return {
    piModel: model,
    apiKey: 'test-key',
    systemPrompt: 'You are a test assistant.',
    tools: [],
    history: [],
    userMessage: 'Hello',
    streamFn: createScriptedStream([assistantMessage([{ type: 'text', text: 'Hello back' }])]),
    onEvent: () => undefined,
    ...overrides,
  }
}

describe('runAgentCore runtime contract', () => {
  it('streams thinking, content, and usage into ChatLab events', async () => {
    const events: AgentCoreEvent[] = []
    const result = await runAgentCore(
      createOptions({
        streamFn: createScriptedStream([
          {
            ...assistantMessage([
              { type: 'thinking', thinking: 'Checking the request' },
              { type: 'text', text: 'Finished' },
            ]),
            usage: {
              ...emptyUsage,
              input: 12,
              output: 5,
              totalTokens: 17,
            },
          },
        ]),
        onEvent: (event) => events.push(event),
      })
    )

    assert.deepEqual(
      events.filter((event) => event.type === 'thinking_delta' || event.type === 'content'),
      [
        { type: 'thinking_delta', content: 'Checking the request' },
        { type: 'content', content: 'Finished' },
      ]
    )
    assert.deepEqual(result.usage, {
      promptTokens: 12,
      completionTokens: 5,
      totalTokens: 17,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
  })

  it('executes a tool and continues to the final response', async () => {
    const events: AgentCoreEvent[] = []
    const calls: string[] = []
    const toolCall: ToolCall = { type: 'toolCall', id: 'tool-1', name: 'lookup', arguments: {} }
    const tool = createTool('lookup', async () => {
      calls.push('lookup')
      return { content: [{ type: 'text', text: 'tool result' }], details: { ok: true } }
    })

    const result = await runAgentCore(
      createOptions({
        tools: [tool],
        streamFn: createScriptedStream([
          assistantMessage([toolCall], { stopReason: 'toolUse' }),
          assistantMessage([{ type: 'text', text: 'Final answer' }]),
        ]),
        onEvent: (event) => events.push(event),
      })
    )

    assert.deepEqual(calls, ['lookup'])
    assert.deepEqual(result.toolsUsed, ['lookup'])
    assert.equal(result.toolRounds, 1)
    assert.equal(
      events.some((event) => event.type === 'tool_start' && event.toolCallId === 'tool-1'),
      true
    )
    assert.equal(
      events.some((event) => event.type === 'tool_end' && !event.isError),
      true
    )
    assert.equal(
      events.some((event) => event.type === 'content' && event.content === 'Final answer'),
      true
    )
  })

  it('turns thrown tool errors into error tool results and keeps the agent loop recoverable', async () => {
    const events: AgentCoreEvent[] = []
    const tool = createTool('broken_tool', async () => {
      throw new Error('tool failed')
    })

    const result = await runAgentCore(
      createOptions({
        tools: [tool],
        streamFn: createScriptedStream([
          assistantMessage([{ type: 'toolCall', id: 'tool-error', name: 'broken_tool', arguments: {} }], {
            stopReason: 'toolUse',
          }),
          assistantMessage([{ type: 'text', text: 'Recovered' }]),
        ]),
        onEvent: (event) => events.push(event),
      })
    )

    assert.equal(
      events.some((event) => event.type === 'tool_end' && event.toolCallId === 'tool-error' && event.isError),
      true
    )
    assert.equal(result.error, undefined)
    assert.equal(
      events.some((event) => event.type === 'content' && event.content === 'Recovered'),
      true
    )
  })

  it('disables tools and injects the final-answer steer message at the tool round limit', async () => {
    let finalContext: Context | undefined
    const tool = createTool('lookup', async () => ({
      content: [{ type: 'text', text: 'tool result' }],
      details: null,
    }))

    const result = await runAgentCore(
      createOptions({
        tools: [tool],
        maxToolRounds: 1,
        steerMessage: 'Finish now.',
        streamFn: createScriptedStream([
          assistantMessage([{ type: 'toolCall', id: 'tool-limit', name: 'lookup', arguments: {} }], {
            stopReason: 'toolUse',
          }),
          (context) => {
            finalContext = context
            return assistantMessage([{ type: 'text', text: 'Done' }])
          },
        ]),
      })
    )

    assert.equal(result.toolRounds, 1)
    assert.deepEqual(finalContext?.tools, [])
    assert.equal(
      finalContext?.messages.some(
        (message) =>
          message.role === 'user' &&
          Array.isArray(message.content) &&
          message.content.some((block) => block.type === 'text' && block.text === 'Finish now.')
      ),
      true
    )
  })
})
