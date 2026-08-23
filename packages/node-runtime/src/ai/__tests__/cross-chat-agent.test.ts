import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Api as PiApi, Model as PiModel } from '@earendil-works/pi-ai'
import type { AIChatManager } from '../chats'
import type { AgentStreamChunk } from '../agent/event-handler'
import {
  buildCrossChatSystemPrompt,
  resolveCrossChatToolResultTokenBudget,
  runCrossChatAgent,
} from '../cross-chat-agent'

describe('cross-chat tool result budget', () => {
  it('keeps the proportional budget for ordinary models and caps very large contexts', () => {
    assert.equal(resolveCrossChatToolResultTokenBudget(128_000), 64_000)
    assert.equal(resolveCrossChatToolResultTokenBudget(1_000_000), 128_000)
  })
})

describe('cross-chat agent prompt', () => {
  it('locks the agent to dedicated tools and makes scope semantic rather than persistent', () => {
    const prompt = buildCrossChatSystemPrompt('zh-CN', new Date('2026-08-23T12:00:00Z'))
    for (const tool of [
      'resolve_chat_entities',
      'read_recent_session',
      'inspect_contact_sessions',
      'inspect_shared_interactions',
      'search_messages_globally',
      'get_cross_chat_message_context',
      'get_cross_chat_overview',
    ]) {
      assert.match(prompt, new RegExp(tool))
    }
    assert.match(prompt, /不构成永久锁定范围/)
    assert.match(prompt, /交集、并集/)
    assert.match(prompt, /不要仅因为消息中出现了 @联系人就机械调用/)
    assert.match(prompt, /roster_only/)
    assert.match(prompt, /不要为了多人问题机械地先对每个人调用 inspect_contact_sessions/)
    assert.match(prompt, /所有参与者都出现.*严格交集/)
    assert.match(prompt, /群名称、成员结构、共同活跃和相邻发言只是调查导航信号/)
    assert.match(prompt, /partial\/skipped_budget 不是零/)
    assert.match(prompt, /唯一候选自动继续/)
    assert.match(prompt, /多个候选必须停下来请用户确认/)
    assert.match(prompt, /限定 scopes 时，可以不提供关键词/)
    assert.match(prompt, /最近.*30 天/)
    assert.match(prompt, /recent_days/)
    assert.match(prompt, /当前日期是.*2026.*8.*23/)
    assert.match(prompt, /真实当前时间为基准/)
    assert.match(prompt, /禁止根据数据库截止时间.*手工计算/)
    assert.match(prompt, /sender.*owner/)
    assert.match(prompt, /本人发言.*检索种子/)
    assert.match(prompt, /“我和某人最近聊了什么”/)
    assert.match(prompt, /只使用.*私聊/)
    assert.match(prompt, /直接调用 read_recent_session/)
    assert.match(prompt, /不要先用 search_messages_globally.*填满.*证据预算/)
    assert.match(prompt, /不要仅因为.*hasEarlierMessages=true.*自动扩大搜索/)
    assert.match(prompt, /最近一条已导入私聊.*具体时间/)
    assert.match(prompt, /工具自行控制证据量/)
    assert.match(prompt, /不要传入消息数量、会话数量或执行时长预算/)
    assert.match(prompt, /coverage/)
    assert.doesNotMatch(prompt, /四个工具/)
    assert.doesNotMatch(prompt, /可以使用.*execute_sql/)
  })

  it('keeps the English prompt on the same seven-tool investigation contract', () => {
    const prompt = buildCrossChatSystemPrompt('en-US', new Date('2026-08-23T12:00:00Z'))
    for (const tool of [
      'resolve_chat_entities',
      'read_recent_session',
      'inspect_contact_sessions',
      'inspect_shared_interactions',
      'search_messages_globally',
      'get_cross_chat_message_context',
      'get_cross_chat_overview',
    ]) {
      assert.match(prompt, new RegExp(tool))
    }
    assert.match(prompt, /strict intersection containing every participant/)
    assert.match(prompt, /investigation signals, not proof/)
    assert.match(prompt, /partial or skipped_budget never means zero/)
    assert.match(prompt, /current date is.*August 23, 2026/i)
    assert.match(prompt, /real current time/)
    assert.match(prompt, /Never calculate start_time from a dataset cutoff/)
    assert.match(prompt, /last 30 days/)
    assert.match(prompt, /what have this person and I been talking about recently/i)
    assert.match(prompt, /use only the resolved direct private session/i)
    assert.match(prompt, /call read_recent_session instead of filling the cross-chat search evidence budget/i)
    assert.match(prompt, /Do not expand merely because selection.hasEarlierMessages is true/i)
    assert.match(prompt, /latest imported private-chat timestamp/i)
    assert.match(prompt, /tool controls evidence volume/i)
    assert.match(prompt, /Do not pass message-count, session-count, or execution-time budgets/)
    assert.doesNotMatch(prompt, /four tools/)
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
