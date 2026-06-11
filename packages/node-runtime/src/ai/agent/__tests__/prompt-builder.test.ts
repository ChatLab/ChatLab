/**
 * Tests for shared prompt-builder.
 *
 * Run: npx tsx --test packages/node-runtime/src/ai/agent/__tests__/prompt-builder.test.ts
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildSystemPrompt } from '../prompt-builder'
import type { TranslateFn } from '../prompt-builder'

const mockT: TranslateFn = (key, options) => {
  if (key.startsWith('ai.agent.fallbackRoleDefinition')) return `[fallback:${key}]`
  if (key === 'ai.agent.currentDateIs') return 'Current date is'
  if (key === 'ai.agent.ownerNote') return `Owner: ${(options as Record<string, unknown>)?.displayName}`
  if (key === 'ai.agent.memberNoteGroup') return '[member-group]'
  if (key === 'ai.agent.memberNotePrivate') return '[member-private]'
  if (key === 'ai.agent.timeParamsIntro') return '[time-params]'
  if (key === 'ai.agent.defaultYearNote') return `[year:${(options as Record<string, unknown>)?.year}]`
  if (key === 'ai.agent.dataSnapshotNote') {
    const opts = options as Record<string, unknown>
    return `[snapshot:${opts.name}:${opts.totalMessages}:${opts.lastMessageDate}]`
  }
  if (key === 'ai.agent.dataSnapshotContext') {
    const opts = options as Record<string, unknown>
    return `[snapshot-context]
- name: ${opts.name}
- platform: ${opts.platform}
- type: ${opts.type}
- total_messages: ${opts.totalMessages}
- total_members: ${opts.totalMembers}
- first_message_ts: ${opts.firstMessageTs}
- first_message_time: ${opts.firstMessageTime}
- last_message_ts: ${opts.lastMessageTs}
- last_message_time: ${opts.lastMessageTime}
- segment_summaries_available: ${opts.segmentSummaryCount}

${opts.memberHintTitle}
${opts.memberHintLines}

${opts.usageRules}`
  }
  if (key === 'ai.agent.dataSnapshotMemberHintsAll') return '活跃成员查询提示（全部成员）：'
  if (key === 'ai.agent.dataSnapshotMemberHintsTop') return '活跃成员查询提示（按历史总消息量 Top 10）：'
  if (key === 'ai.agent.dataSnapshotMemberHintsUnavailable') return '活跃成员查询提示：'
  if (key === 'ai.agent.dataSnapshotMemberHintsEmpty') return '无可用成员提示。'
  if (key === 'ai.agent.dataSnapshotUsageRules') {
    return `- member_id 是工具查询提示；display_name 仅用于人类识别，可能不唯一。
- 不要在最终回答中主动暴露 member_id 或启动上下文本身，除非用户明确要求技术细节。
- 活跃成员排行只代表历史总消息量，不代表最近活跃情况。
- 相对时间表达以真实当前日期为基准，而不是数据库最后消息时间。
- 不要只为了重新发现 min/max timestamp 调用工具。
- last_message_time 是数据库中已导入消息的截止时间，不是群组在现实中最后一次发言的时间；不要据此推断群组多久没动静。`
  }
  if (key === 'ai.agent.evidencePolicy') return '[evidence-policy]'
  if (key === 'ai.agent.responseInstruction') return '[response-instruction]'
  if (key === 'ai.agent.mentionedMembersNote') return 'Mentioned members:'
  if (key === 'ai.agent.currentTask') return 'Current task'
  if (key === 'ai.agent.skillPriorityNote') return '[skill-priority]'
  return `[${key}]`
}

describe('buildSystemPrompt', () => {
  it('uses fallback role when no assistant prompt', () => {
    const result = buildSystemPrompt({ t: mockT, chatType: 'group' })
    assert.ok(result.includes('[fallback:ai.agent.fallbackRoleDefinition.group]'))
  })

  it('uses assistant prompt when provided', () => {
    const result = buildSystemPrompt({ t: mockT, assistantSystemPrompt: 'Custom assistant' })
    assert.ok(result.includes('Custom assistant'))
    assert.ok(!result.includes('[fallback'))
  })

  it('includes owner info when provided', () => {
    const result = buildSystemPrompt({
      t: mockT,
      ownerInfo: { displayName: 'Alice', platformId: 'alice123' },
    })
    assert.ok(result.includes('Owner: Alice'))
  })

  it('includes member note for private chat', () => {
    const result = buildSystemPrompt({ t: mockT, chatType: 'private' })
    assert.ok(result.includes('[member-private]'))
  })

  it('includes mentioned members', () => {
    const result = buildSystemPrompt({
      t: mockT,
      mentionedMembers: [{ memberId: 1, platformId: 'p1', displayName: 'Bob', aliases: ['B'], mentionText: '@Bob' }],
    })
    assert.ok(result.includes('member_id=1'))
    assert.ok(result.includes('aliases=B'))
  })

  it('includes skill definition when active', () => {
    const result = buildSystemPrompt({
      t: mockT,
      skillCtx: { skillDef: { name: 'Summarizer', prompt: 'Summarize the chat.' } },
    })
    assert.ok(result.includes('Current task'))
    assert.ok(result.includes('Summarizer'))
    assert.ok(result.includes('Summarize the chat.'))
  })

  it('includes skill menu when no active skill', () => {
    const result = buildSystemPrompt({
      t: mockT,
      skillCtx: { skillMenu: '[SKILL MENU TEXT]' },
    })
    assert.ok(result.includes('[SKILL MENU TEXT]'))
  })

  it('includes date and response instruction', () => {
    const result = buildSystemPrompt({ t: mockT })
    assert.ok(result.includes('Current date is'))
    assert.ok(result.includes('[response-instruction]'))
  })

  it('includes evidence policy in locked section', () => {
    const result = buildSystemPrompt({ t: mockT })
    assert.ok(result.includes('[evidence-policy]'))
    assert.ok(result.indexOf('[evidence-policy]') < result.indexOf('[response-instruction]'))
  })

  it('includes current data snapshot when provided', () => {
    const result = buildSystemPrompt({
      t: mockT,
      dataSnapshot: {
        name: 'Team Chat',
        platform: 'wechat',
        type: 'group',
        totalMessages: 1234,
        totalMembers: 56,
        firstMessageTs: 1700000000,
        lastMessageTs: 1700003600,
        capturedAt: 1700007200,
      },
    })

    assert.ok(result.includes('[snapshot-context]'))
    assert.ok(result.includes('total_messages: 1234'))
    assert.ok(result.includes('segment_summaries_available: 0'))
    assert.ok(result.includes('[evidence-policy]'))
  })

  it('renders extended data snapshot startup context and rules', () => {
    const result = buildSystemPrompt({
      t: mockT,
      locale: 'zh-CN',
      dataSnapshot: {
        version: 2,
        name: 'Team Chat',
        platform: 'wechat',
        type: 'group',
        totalMessages: 100,
        totalMembers: 2,
        firstMessageTs: 1735689600,
        lastMessageTs: 1767225599,
        activeMemberHints: [
          { memberId: 1, displayName: 'Alice', messageCount: 60, share: 60 },
          { memberId: 2, displayName: 'Bob', messageCount: 40, share: 40 },
        ],
        segmentSummaries: { availableCount: 12 },
      },
    })

    assert.ok(result.includes('first_message_ts: 1735689600'))
    assert.ok(result.includes('last_message_ts: 1767225599'))
    assert.ok(result.includes('segment_summaries_available: 12'))
    assert.ok(result.includes('member_id=1 | display_name=Alice | messages=60 | share=60%'))
    assert.ok(result.includes('member_id=2 | display_name=Bob | messages=40 | share=40%'))
    assert.ok(result.includes('历史总消息量'))
    assert.ok(result.includes('真实当前日期'))
    assert.ok(result.includes('不要只为了重新发现 min/max timestamp 调用工具'))
    assert.ok(!result.includes('platform_id='))
    assert.ok(!result.includes('aliases='))
  })
})
