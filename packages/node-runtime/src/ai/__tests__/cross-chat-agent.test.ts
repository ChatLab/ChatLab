import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Api as PiApi, Model as PiModel } from '@earendil-works/pi-ai'
import type { AIChatManager } from '../chats'
import type { AgentStreamChunk } from '../agent/event-handler'
import { buildCrossChatSystemPrompt, runCrossChatAgent } from '../cross-chat-agent'

describe('cross-chat agent prompt', () => {
  it('locks the agent to dedicated tools and makes scope semantic rather than persistent', () => {
    const prompt = buildCrossChatSystemPrompt('zh-CN')
    for (const tool of [
      'resolve_chat_entities',
      'search_messages_globally',
      'get_cross_chat_message_context',
      'get_cross_chat_overview',
    ]) {
      assert.match(prompt, new RegExp(tool))
    }
    assert.match(prompt, /不构成永久锁定范围/)
    assert.match(prompt, /交集、并集/)
    assert.match(prompt, /唯一候选自动继续/)
    assert.match(prompt, /多个候选必须停下来请用户确认/)
    assert.match(prompt, /限定 scopes 时，可以不提供关键词/)
    assert.match(prompt, /最近.*90 天/)
    assert.match(prompt, /recent_days/)
    assert.match(prompt, /sender.*owner/)
    assert.match(prompt, /本人发言.*检索种子/)
    assert.match(prompt, /coverage/)
    assert.doesNotMatch(prompt, /可以使用.*execute_sql/)
  })
})

describe('cross-chat agent lifecycle', () => {
  it('skips compression work when the request is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const events: AgentStreamChunk[] = []
    let compressionReads = 0
    const aiChatManager = {
      getLatestSummary() {
        compressionReads++
        return null
      },
    } as unknown as AIChatManager
    const piModel = {
      id: 'test-model',
      name: 'Test model',
      api: 'openai-completions',
      provider: 'test',
    } as unknown as PiModel<PiApi>

    await runCrossChatAgent({
      userMessage: '分析一下',
      aiChatId: 'global-chat-1',
      piModel,
      apiKey: 'test-key',
      tools: [],
      aiChatManager,
      abortSignal: controller.signal,
      onEvent: (event) => events.push(event),
    })

    assert.equal(compressionReads, 0)
    assert.deepEqual(
      events.filter((event) => event.type === 'status').map((event) => event.status?.phase),
      ['aborted']
    )
    assert.equal(events.at(-1)?.type, 'done')
  })

  it('finishes as aborted when cancellation happens after the initial check', async () => {
    const controller = new AbortController()
    const events: AgentStreamChunk[] = []
    const loggedErrors: unknown[] = []
    const aiChatManager = {
      getHistoryForAgent() {
        controller.abort()
        return []
      },
    } as unknown as AIChatManager
    const piModel = {
      id: 'test-model',
      name: 'Test model',
      api: 'openai-completions',
      provider: 'test',
    } as unknown as PiModel<PiApi>

    await runCrossChatAgent({
      userMessage: '你觉得这个方案怎么样？',
      aiChatId: 'global-chat-1',
      historyLeafMessageId: null,
      piModel,
      apiKey: 'test-key',
      tools: [],
      aiChatManager,
      abortSignal: controller.signal,
      onEvent: (event) => events.push(event),
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: (_category, _message, error) => loggedErrors.push(error),
      },
    })

    const terminalStatuses = events
      .filter((event) => event.type === 'status')
      .map((event) => event.status?.phase)
      .filter((phase) => phase === 'completed' || phase === 'aborted' || phase === 'error')
    assert.deepEqual(terminalStatuses, ['aborted'])
    assert.equal(
      events.some((event) => event.type === 'error'),
      false
    )
    assert.equal(events.at(-1)?.type, 'done')
    assert.deepEqual(loggedErrors, [])
  })
})
