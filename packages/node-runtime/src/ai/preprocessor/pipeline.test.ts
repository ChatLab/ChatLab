/**
 * Tests for preprocessing pipeline extensions (agent-friendly CLI, P2).
 *
 * Covers:
 * - preprocessMessagesWithStats step statistics
 * - merged block first/last id tracking (mergedEndId)
 * - string-level privacy API: desensitizeText / matchesBlacklist
 * - regression: default behavior of preprocessMessages stays unchanged
 *
 * Run: npx tsx --test packages/node-runtime/src/ai/preprocessor/pipeline.test.ts
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { preprocessMessages, preprocessMessagesWithStats, desensitizeText, matchesBlacklist } from './pipeline'
import type { PreprocessConfig, PreprocessableMessage, DesensitizeRule } from './types'

function baseConfig(overrides: Partial<PreprocessConfig> = {}): PreprocessConfig {
  return {
    dataCleaning: true,
    mergeConsecutive: false,
    blacklistKeywords: [],
    denoise: false,
    desensitize: false,
    desensitizeRules: [],
    anonymizeNames: false,
    ...overrides,
  }
}

function msg(id: number, senderName: string, content: string | null, timestamp: number): PreprocessableMessage {
  return { id, senderName, content, timestamp }
}

const phoneRule: DesensitizeRule = {
  id: 'cn_phone',
  label: '手机号',
  pattern: '1[3-9]\\d{9}',
  replacement: '[手机号]',
  enabled: true,
  builtin: true,
  locales: ['zh-CN'],
}

describe('preprocessMessagesWithStats', () => {
  it('reports per-step counts and final output size', () => {
    const messages = [
      msg(1, 'Alice', '正常消息内容', 1710000000),
      msg(2, 'Bob', '包含秘密项目的消息', 1710000060),
      msg(3, 'Alice', '联系我 13812345678', 1710000120),
    ]
    const { messages: result, stats } = preprocessMessagesWithStats(
      messages,
      baseConfig({
        blacklistKeywords: ['秘密项目'],
        desensitize: true,
        desensitizeRules: [phoneRule],
      })
    )

    assert.equal(stats.input, 3)
    assert.equal(stats.blacklistRemoved, 1)
    assert.equal(stats.output, 2)
    assert.equal(stats.desensitizeRulesApplied, 1)
    assert.equal(result.length, 2)
    assert.ok(result[1].content!.includes('[手机号]'))
    assert.ok(!result.some((m) => m.content?.includes('秘密项目')))
  })

  it('records merged block last id via mergedEndId', () => {
    const messages = [
      msg(10, 'Alice', '第一条', 1710000000),
      msg(11, 'Alice', '第二条', 1710000030),
      msg(12, 'Alice', '第三条', 1710000060),
      msg(13, 'Bob', '另一个人', 1710000090),
    ]
    const { messages: result, stats } = preprocessMessagesWithStats(messages, baseConfig({ mergeConsecutive: true }))

    assert.equal(result.length, 2)
    assert.equal(result[0].id, 10)
    assert.equal(result[0].mergedEndId, 12)
    assert.equal(result[0].content, '第一条\n第二条\n第三条')
    assert.equal(result[1].id, 13)
    assert.equal(result[1].mergedEndId, undefined)
    assert.equal(stats.mergeCombined, 2)
  })

  it('returns zeroed stats when config disables everything', () => {
    const messages = [msg(1, 'Alice', 'hello', 1710000000)]
    const { messages: result, stats } = preprocessMessagesWithStats(messages, undefined)
    assert.equal(result.length, 1)
    assert.equal(stats.input, 1)
    assert.equal(stats.output, 1)
    assert.equal(stats.blacklistRemoved, 0)
  })
})

describe('preprocessMessages default behavior regression', () => {
  it('produces identical output to preprocessMessagesWithStats().messages', () => {
    const messages = [
      msg(1, 'Alice', '你好 13812345678', 1710000000),
      msg(2, 'Alice', '连续发言', 1710000030),
      msg(3, 'Bob', '广告内容', 1710000060),
    ]
    const config = baseConfig({
      mergeConsecutive: true,
      blacklistKeywords: ['广告'],
      desensitize: true,
      desensitizeRules: [phoneRule],
    })
    const plain = preprocessMessages(messages, config)
    const withStats = preprocessMessagesWithStats(messages, config)
    assert.deepEqual(plain, withStats.messages)
  })
})

describe('desensitizeText', () => {
  it('applies enabled rules to a plain string', () => {
    const out = desensitizeText('电话 13812345678，邮箱 a@b.com', [phoneRule])
    assert.equal(out, '电话 [手机号]，邮箱 a@b.com')
  })

  it('skips disabled rules and tolerates invalid regex', () => {
    const disabled: DesensitizeRule = { ...phoneRule, enabled: false }
    const invalid: DesensitizeRule = {
      id: 'bad',
      label: 'bad',
      pattern: '([unclosed',
      replacement: 'X',
      enabled: true,
      builtin: false,
      locales: [],
    }
    const out = desensitizeText('电话 13812345678', [disabled, invalid])
    assert.equal(out, '电话 13812345678')
  })
})

describe('matchesBlacklist', () => {
  it('is case-insensitive substring matching', () => {
    assert.equal(matchesBlacklist('内含 SecretPlan 字样', ['secretplan']), true)
    assert.equal(matchesBlacklist('干净文本', ['secretplan']), false)
    assert.equal(matchesBlacklist('任何文本', []), false)
  })
})
