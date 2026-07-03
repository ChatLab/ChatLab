/**
 * Tests for shared message output shaping: json items keep privacy steps
 * (cleaning/blacklist/desensitize) without merging, agent text goes through the
 * full pipeline with [#id] citations, and --raw only pairs with json/text.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { PreprocessConfig } from '@openchatlab/node-runtime'
import {
  privacyOnlyConfig,
  toJsonItems,
  buildAgentText,
  buildMessagesResult,
  assertRawFormatCompatible,
  type MessageLike,
} from './messages-output'
import { QueryError } from './envelope'

const phoneRule = {
  id: 'cn_phone',
  label: 'CN phone',
  pattern: '1[3-9]\\d{9}',
  replacement: '[手机号]',
  enabled: true,
  builtin: true,
  locales: ['zh-CN'],
}

function makeConfig(overrides: Partial<PreprocessConfig> = {}): PreprocessConfig {
  return {
    dataCleaning: true,
    mergeConsecutive: true,
    mergeWindowSeconds: 180,
    blacklistKeywords: ['机密'],
    denoise: false,
    desensitize: true,
    desensitizeRules: [phoneRule],
    anonymizeNames: false,
    ...overrides,
  }
}

const messages: MessageLike[] = [
  { id: 1, senderId: 10, senderName: '老王', content: '我的手机号是 13812345678', timestamp: 1_760_000_000, type: 0 },
  { id: 2, senderId: 11, senderName: '小红', content: '这是机密文件不要外传', timestamp: 1_760_000_060, type: 0 },
  { id: 3, senderId: 11, senderName: '小红', content: '旅游计划下周讨论', timestamp: 1_760_000_120, type: 0 },
  { id: 4, senderId: 11, senderName: '小红', content: '先订机票', timestamp: 1_760_000_150, type: 0 },
]

const ctx = { preprocessConfig: makeConfig(), locale: 'zh-CN', ownerPlatformId: undefined }

describe('privacyOnlyConfig', () => {
  it('keeps privacy steps but disables merge/denoise/anonymize', () => {
    const config = privacyOnlyConfig(makeConfig({ denoise: true, anonymizeNames: true }))
    assert.equal(config.mergeConsecutive, false)
    assert.equal(config.denoise, false)
    assert.equal(config.anonymizeNames, false)
    assert.equal(config.desensitize, true)
    assert.deepEqual(config.blacklistKeywords, ['机密'])
  })
})

describe('toJsonItems', () => {
  it('applies desensitize and blacklist without merging', () => {
    const items = toJsonItems(messages, makeConfig(), {})
    // blacklisted message 2 removed, no merge of 3+4
    assert.deepEqual(
      items.map((i) => i.id),
      [1, 3, 4]
    )
    assert.ok(String(items[0].content).includes('[手机号]'))
    assert.ok(!String(items[0].content).includes('13812345678'))
  })

  it('keeps raw content when raw is set (gate is checked by the caller)', () => {
    const items = toJsonItems(messages, makeConfig(), { raw: true })
    assert.equal(items.length, 4)
    assert.ok(String(items[0].content).includes('13812345678'))
  })

  it('supports --no-content and --fields for structural scouting', () => {
    const noContent = toJsonItems(messages, makeConfig(), { content: false })
    assert.ok(noContent.every((i) => !('content' in i)))

    const projected = toJsonItems(messages, makeConfig(), { fields: 'id,senderName' })
    assert.deepEqual(Object.keys(projected[0]).sort(), ['id', 'senderName'])
  })

  it('rejects unknown --fields entries', () => {
    assert.throws(
      () => toJsonItems(messages, makeConfig(), { fields: 'id,nope' }),
      (err: unknown) => err instanceof QueryError && err.code === 'INVALID_ARGUMENT'
    )
  })

  it('truncates content at maxChars and marks hits', () => {
    const items = toJsonItems(messages, makeConfig(), { maxChars: '5', hitIds: new Set([3]) })
    const travel = items.find((i) => i.id === 3)!
    assert.equal(travel.content, '旅游计划下...')
    assert.equal(travel.hit, true)
    assert.ok(!('hit' in items.find((i) => i.id === 1)!))
  })

  it('renders type as a semantic string', () => {
    const items = toJsonItems(messages, makeConfig(), {})
    assert.equal(items[0].type, 'text')
  })
})

describe('buildAgentText', () => {
  it('produces pipeline text with [#id] citations, merged ranges and privacy applied', () => {
    const result = buildAgentText(messages, ctx, { strategy: 'keep_first' })
    assert.ok(result.text.includes('[#1]'))
    assert.ok(result.text.includes('[#3-4]'), `expected merged range in:\n${result.text}`)
    assert.ok(result.text.includes('[手机号]'))
    assert.ok(!result.text.includes('机密'))
    assert.deepEqual(result.preprocess, {
      cleaned: true,
      denoised: false,
      merged: true,
      desensitized: true,
      truncated: false,
    })
  })

  it('marks search hits with [#id*]', () => {
    const result = buildAgentText(
      messages,
      { ...ctx, preprocessConfig: makeConfig({ mergeConsecutive: false }) },
      {
        strategy: 'keep_first',
        hitIds: [3],
      }
    )
    assert.ok(result.text.includes('[#3*]'), result.text)
  })

  it('exposes per-step diagnostics only with verbose', () => {
    const quiet = buildAgentText(messages, ctx, { strategy: 'keep_first' })
    assert.equal(quiet.preprocessDetail, undefined)

    const verbose = buildAgentText(messages, ctx, { strategy: 'keep_first', verbose: true })
    assert.equal(verbose.preprocessDetail?.inputMessages, 4)
    assert.equal(verbose.preprocessDetail?.blacklistRemoved, 1)
  })
})

describe('buildMessagesResult', () => {
  it('returns data.text for agent format and data.items for json format', () => {
    const agent = buildMessagesResult('agent', ctx, {}, messages, { totalHits: 4 }, { strategy: 'keep_first' })
    assert.ok((agent.data as { text: string }).text.includes('[#1]'))
    assert.equal(agent.meta?.totalHits, 4)
    assert.ok(agent.meta?.preprocess)

    const json = buildMessagesResult('json', ctx, {}, messages, { totalHits: 4 }, { strategy: 'keep_first' })
    const items = (json.data as { items: unknown[] }).items
    assert.equal(items.length, 3)
    assert.equal(json.meta?.returned, 3)
  })

  it('sorts input chronologically before shaping', () => {
    const reversed = [...messages].reverse()
    const json = buildMessagesResult('json', ctx, {}, reversed, {}, { strategy: 'keep_first' })
    const ids = ((json.data as { items: Array<{ id: number }> }).items ?? []).map((i) => i.id)
    assert.deepEqual(ids, [1, 3, 4])
  })
})

describe('assertRawFormatCompatible', () => {
  it('rejects --raw with agent format only', () => {
    assert.throws(
      () => assertRawFormatCompatible('agent', { raw: true }),
      (err: unknown) => err instanceof QueryError && err.code === 'INVALID_ARGUMENT'
    )
    assert.doesNotThrow(() => assertRawFormatCompatible('json', { raw: true }))
    assert.doesNotThrow(() => assertRawFormatCompatible('agent', {}))
  })
})
