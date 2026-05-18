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

    assert.ok(result.includes('[snapshot:Team Chat:1234:'))
    assert.ok(result.includes('[evidence-policy]'))
  })
})
