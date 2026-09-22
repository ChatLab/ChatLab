import assert from 'node:assert/strict'
import test from 'node:test'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import type { AIServiceConfig } from '../../ai'
import { completeSimple } from '../../ai/pi-runtime'
import { createChatTopicModelClient } from './model-client'

const anthropicConfig: AIServiceConfig = {
  id: 'synthetic',
  name: 'Synthetic',
  provider: 'anthropic',
  apiFormat: 'anthropic-messages',
  model: 'qwen3.8-flash',
  baseUrl: 'https://test.cn-beijing.maas.aliyuncs.com/apps/anthropic',
  apiKey: 'test-key',
  createdAt: 1,
  updatedAt: 1,
}

// Prevent provider-default thinking from consuming the topic result budget, without changing other APIs/models.
for (const { config, expectedThinking } of [
  { config: anthropicConfig, expectedThinking: { type: 'disabled' } },
  {
    config: { ...anthropicConfig, provider: 'openai-compatible', baseUrl: 'https://example.invalid/anthropic/v1' },
    expectedThinking: { type: 'disabled' },
  },
  { config: { ...anthropicConfig, model: 'claude-sonnet-4-5' }, expectedThinking: undefined },
  { config: { ...anthropicConfig, apiFormat: 'openai-completions' as const }, expectedThinking: undefined },
]) {
  test(`topic thinking payload for ${config.provider}/${config.apiFormat}/${config.model}`, async () => {
    let request: Record<string, unknown> | undefined
    const client = createChatTopicModelClient(config, {
      completeSimple: (model, context, options) =>
        completeSimple(model, context, {
          ...options,
          onPayload: async (payload, model) => {
            request = ((await options?.onPayload?.(payload, model)) ?? payload) as Record<string, unknown>
            throw new Error('Captured topic request before network')
          },
        }),
    })
    await assert.rejects(
      () =>
        client.complete(
          { systemPrompt: 'Return JSON only.', userPrompt: 'Synthetic messages' },
          { signal: new AbortController().signal, sessionId: 'synthetic' }
        ),
      /Captured topic request before network/
    )
    assert.ok(request)
    assert.deepEqual(request.thinking, expectedThinking)
    if (config.apiFormat === 'anthropic-messages') assert.equal(request.max_tokens, 4096)
  })
}

// Truncated output must remain distinguishable from invalid JSON, while retaining billable usage.
for (const { content, stopReason, expectedLimit } of [
  {
    content: [{ type: 'thinking', thinking: 'Synthetic reasoning' }],
    stopReason: 'length',
    expectedLimit: 'reasoning',
  },
  { content: [{ type: 'text', text: '{"operations":' }], stopReason: 'length', expectedLimit: 'text' },
  {
    content: [{ type: 'text', text: '{"operations":[],"assignments":[]}' }],
    stopReason: 'stop',
    expectedLimit: undefined,
  },
] satisfies Array<{
  content: AssistantMessage['content']
  stopReason: AssistantMessage['stopReason']
  expectedLimit?: string
}>) {
  test(`topic response preserves ${stopReason}/${expectedLimit ?? 'complete'} and usage`, async () => {
    const client = createChatTopicModelClient(anthropicConfig, {
      completeSimple: async (model) => ({
        role: 'assistant',
        content,
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
          input: 120,
          output: 4096,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 4216,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason,
        timestamp: Date.now(),
      }),
    })
    const result = await client.complete(
      { systemPrompt: 'Return JSON only.', userPrompt: 'Synthetic messages' },
      { signal: new AbortController().signal, sessionId: 'synthetic' }
    )
    assert.equal(result.outputLimit, expectedLimit)
    assert.equal(result.inputTokens, 120)
    assert.equal(result.outputTokens, 4096)
    assert.equal(result.text, content[0].type === 'text' ? content[0].text : '')
  })
}

// Prevent topic requests from failing with HTTP 400 on Qwen endpoints that reject the developer role.
for (const { provider, model, expectedRole } of [
  { provider: 'qwen', model: 'qwen3.8', expectedRole: 'system' },
  { provider: 'openai-compatible', model: 'qwen3.8', expectedRole: 'system' },
  { provider: 'openai-compatible', model: 'Qwen/QwQ-32B', expectedRole: 'system' },
  { provider: 'openai', model: 'o3', expectedRole: 'developer' },
]) {
  test(`topic requests preserve the supported prompt role for ${provider}/${model}`, async () => {
    let messages: Array<{ role: string; content: unknown }> | undefined
    let reasoning: boolean | undefined
    const client = createChatTopicModelClient(
      {
        id: 'synthetic',
        name: 'Synthetic',
        provider,
        model,
        baseUrl: 'https://example.invalid/v1',
        apiKey: 'test-key',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        completeSimple: (model, context, options) => {
          reasoning = model.reasoning
          return completeSimple(model, context, {
            ...options,
            onPayload: async (payload, model) => {
              const normalized = (await options?.onPayload?.(payload, model)) ?? payload
              messages = (normalized as { messages: typeof messages }).messages
              // Capture the real SDK serialization, then stop before any network request.
              throw new Error('Captured topic request before network')
            },
          })
        },
      }
    )
    await assert.rejects(
      () =>
        client.complete(
          { systemPrompt: 'Synthetic system prompt', userPrompt: 'Synthetic user prompt' },
          { signal: new AbortController().signal, sessionId: 'synthetic' }
        ),
      /Captured topic request before network/
    )
    assert.equal(reasoning, true)
    assert.deepEqual(
      messages?.map((message) => message.role),
      [expectedRole, 'user']
    )
    assert.equal(messages?.[0].content, 'Synthetic system prompt')
  })
}

test('topic model calls disable reasoning and constrain the DeepSeek payload', async () => {
  let capturedOptions: Parameters<typeof import('../../ai').completeSimple>[2]
  let normalizedPayload: unknown
  const fakeComplete = (async (
    model: Parameters<typeof import('../../ai').completeSimple>[0],
    _context: Parameters<typeof import('../../ai').completeSimple>[1],
    options: Parameters<typeof import('../../ai').completeSimple>[2]
  ) => {
    capturedOptions = options
    normalizedPayload = await options?.onPayload?.(
      {
        model: model.id,
        max_completion_tokens: 4096,
        thinking: { type: 'enabled' },
        reasoning_effort: 'high',
        stream: true,
      },
      model
    )
    return {
      role: 'assistant',
      content: [{ type: 'text', text: '{"operations":[]}' }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 10,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 15,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop',
      timestamp: Date.now(),
    }
  }) as typeof import('../../ai').completeSimple
  const config: AIServiceConfig = {
    id: 'deepseek',
    name: 'DeepSeek',
    provider: 'deepseek',
    apiKey: 'test-key',
    model: 'deepseek-v4-flash',
    baseUrl: 'https://api.deepseek.com/v1',
    createdAt: 1,
    updatedAt: 1,
  }

  const result = await createChatTopicModelClient(config, { completeSimple: fakeComplete }).complete(
    { systemPrompt: 'system', userPrompt: 'user' },
    { signal: new AbortController().signal, sessionId: 'topic-test' }
  )

  assert.equal(capturedOptions?.reasoning, undefined)
  assert.equal(capturedOptions?.maxTokens, 4096)
  assert.equal(capturedOptions?.timeoutMs, 120_000)
  assert.equal(capturedOptions?.maxRetries, 0)
  assert.deepEqual(normalizedPayload, {
    model: 'deepseek-v4-flash',
    max_tokens: 4096,
    thinking: { type: 'disabled' },
    stream: true,
  })
  assert.deepEqual(result, { text: '{"operations":[]}', inputTokens: 10, outputTokens: 5 })
})
