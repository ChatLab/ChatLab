import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createLlmRouteDecider, decideRequestRoute } from '../router'
import type { RouteDecision, RouteDecisionSource } from '../routing-types'

const baseInput = {
  userMessage: '',
  chatType: 'group' as const,
  locale: 'zh-CN',
  availableTools: ['get_chat_overview', 'search_messages', 'get_member_stats'],
}

const extendedDataSnapshot = {
  version: 2 as const,
  name: 'Team Chat',
  platform: 'wechat',
  type: 'group',
  totalMessages: 1000,
  totalMembers: 12,
  firstMessageTs: 1735689600,
  lastMessageTs: 1767225599,
  activeMemberHints: [{ memberId: 3, displayName: 'Alice', messageCount: 300, share: 30 }],
  segmentSummaries: { availableCount: 8 },
}

describe('decideRequestRoute', () => {
  it('routes concept and help questions to direct response by rule', async () => {
    const concept = await decideRequestRoute({
      ...baseInput,
      userMessage: '解释一下什么是 Function Calling Agent，和 ReACT 有什么区别？',
    })
    assert.equal(concept.route, 'direct_response')
    assert.equal(concept.source, 'rule')
    assert.ok(concept.confidence >= 0.8)

    const help = await decideRequestRoute({
      ...baseInput,
      userMessage: 'ChatLab 的 AI 日志在哪里看？',
    })
    assert.equal(help.route, 'direct_response')
    assert.equal(help.source, 'rule')
  })

  it('routes simple data lookups to tool assisted by rule', async () => {
    const decision = await decideRequestRoute({
      ...baseInput,
      userMessage: '谁发言最多？给我前 5 名就行。',
    })

    assert.equal(decision.route, 'tool_assisted')
    assert.equal(decision.source, 'rule')
    assert.ok(decision.confidence >= 0.75)
  })

  it('routes complex evidence-heavy analysis to planned execution by rule', async () => {
    const decision = await decideRequestRoute({
      ...baseInput,
      userMessage: '分析过去一年群里话题的变化趋势，按季度总结主要变化，并举出证据。',
    })

    assert.equal(decision.route, 'planned_execution')
    assert.equal(decision.source, 'rule')
    assert.ok(decision.confidence >= 0.8)
  })

  it('uses injected LLM fallback for ambiguous requests', async () => {
    const llmDecision: RouteDecision = {
      route: 'planned_execution',
      confidence: 0.72,
      reason: 'LLM detected multiple implicit analysis dimensions.',
      source: 'llm',
    }
    const calls: Array<{ source: RouteDecisionSource; message: string }> = []
    const decision = await decideRequestRoute(
      {
        ...baseInput,
        userMessage: '帮我看一下这个情况。',
      },
      {
        llmRouter: async (input, ruleDecision) => {
          calls.push({ source: ruleDecision.source, message: input.userMessage })
          return llmDecision
        },
      }
    )

    assert.deepEqual(decision, llmDecision)
    assert.deepEqual(calls, [{ source: 'rule', message: '帮我看一下这个情况。' }])
  })

  it('falls back conservatively to tool assisted when ambiguous and no LLM router is provided', async () => {
    const decision = await decideRequestRoute({
      ...baseInput,
      userMessage: '帮我看一下这个情况。',
    })

    assert.equal(decision.route, 'tool_assisted')
    assert.equal(decision.source, 'rule')
    assert.ok(decision.confidence < 0.6)
    assert.match(decision.reason, /ambiguous/i)
  })

  it('creates an LLM fallback decider that parses route JSON', async () => {
    const decider = createLlmRouteDecider({
      complete: async () => '{"route":"direct_response","confidence":1.4,"reason":"No local data dependency."}',
    })

    const decision = await decider(
      {
        ...baseInput,
        userMessage: '帮我看一下这个情况。',
      },
      {
        route: 'tool_assisted',
        confidence: 0.45,
        reason: 'Ambiguous request.',
        source: 'rule',
      }
    )

    assert.equal(decision.route, 'direct_response')
    assert.equal(decision.source, 'llm')
    assert.equal(decision.confidence, 1)
    assert.match(decision.reason, /No local data/)
  })

  it('includes compact extended data snapshot context in the LLM fallback prompt', async () => {
    let capturedPrompt = ''
    const decider = createLlmRouteDecider({
      complete: async (prompt) => {
        capturedPrompt = prompt
        return '{"route":"planned_execution","confidence":0.8,"reason":"Needs trend analysis."}'
      },
    })

    await decider(
      {
        ...baseInput,
        userMessage: '帮我看一下这个情况。',
        dataSnapshot: extendedDataSnapshot,
      },
      {
        route: 'tool_assisted',
        confidence: 0.45,
        reason: 'Ambiguous request.',
        source: 'rule',
      }
    )

    assert.match(capturedPrompt, /total_messages: 1000/)
    assert.match(capturedPrompt, /total_members: 12/)
    assert.match(capturedPrompt, /first_message_ts: 1735689600/)
    assert.match(capturedPrompt, /last_message_ts: 1767225599/)
    assert.match(capturedPrompt, /segment_summaries_available: 8/)
    assert.match(capturedPrompt, /active_member_hint_count: 1/)
  })

  it('keeps the rule decision when LLM fallback output is invalid', async () => {
    const decider = createLlmRouteDecider({
      complete: async () => '{"route":"unknown","confidence":0.9,"reason":"bad"}',
    })
    const ruleDecision: RouteDecision = {
      route: 'tool_assisted',
      confidence: 0.45,
      reason: 'Ambiguous request.',
      source: 'rule',
    }

    const decision = await decider(baseInput, ruleDecision)

    assert.equal(decision.route, 'tool_assisted')
    assert.equal(decision.source, 'rule')
    assert.match(decision.reason, /invalid/i)
  })

  it('does not mark invalid LLM fallback as an LLM-sourced decision', async () => {
    const decision = await decideRequestRoute(
      {
        ...baseInput,
        userMessage: '帮我看一下这个情况。',
      },
      {
        llmRouter: createLlmRouteDecider({
          complete: async () => '{"route":"unknown","confidence":0.9,"reason":"bad"}',
        }),
      }
    )

    assert.equal(decision.route, 'tool_assisted')
    assert.equal(decision.source, 'rule')
    assert.match(decision.reason, /invalid/i)
  })
})
