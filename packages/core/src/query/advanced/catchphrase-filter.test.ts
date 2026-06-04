import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import type { DatabaseAdapter, PreparedStatement } from '../../interfaces'
import { isHumanCatchphraseContent } from './catchphrase-filter'
import { getCatchphraseAnalysis } from './repeat'
import { getLanguagePreferenceAnalysis } from './languagePreference'

const ROWS = [
  { memberId: 1, platformId: 'alice', name: 'Alice', content: '哈哈哈', count: 3 },
  { memberId: 1, platformId: 'alice', name: 'Alice', content: '[表情包]', count: 10 },
  { memberId: 1, platformId: 'alice', name: 'Alice', content: '[图片]', count: 8 },
  { memberId: 1, platformId: 'alice', name: 'Alice', content: 'Alice 撤回了一条消息', count: 6 },
  { memberId: 1, platformId: 'alice', name: 'Alice', content: '收到', count: 2 },
  { memberId: 2, platformId: 'bob', name: 'Bob', content: '明天见', count: 4 },
  { memberId: 2, platformId: 'bob', name: 'Bob', content: 'message was deleted', count: 4 },
]

function createFakeDb(rows: Record<string, unknown>[]): DatabaseAdapter {
  const stmt: PreparedStatement = {
    all: () => rows,
    get: () => undefined,
    run: () => ({ changes: 0 }),
  }

  return {
    exec: () => {},
    prepare: () => stmt,
    transaction: (fn) => fn(),
    pragma: () => undefined,
    close: () => {},
  }
}

describe('isHumanCatchphraseContent', () => {
  it('keeps normal short phrases', () => {
    assert.equal(isHumanCatchphraseContent('哈哈哈'), true)
    assert.equal(isHumanCatchphraseContent('收到'), true)
    assert.equal(isHumanCatchphraseContent('明天见'), true)
  })

  it('filters imported placeholders and system events', () => {
    assert.equal(isHumanCatchphraseContent('[表情包]'), false)
    assert.equal(isHumanCatchphraseContent('[图片]'), false)
    assert.equal(isHumanCatchphraseContent('[Sticker]'), false)
    assert.equal(isHumanCatchphraseContent('Alice 撤回了一条消息'), false)
    assert.equal(isHumanCatchphraseContent('message was deleted'), false)
  })
})

describe('getCatchphraseAnalysis', () => {
  it('excludes non-human placeholder messages from catchphrases', () => {
    const result = getCatchphraseAnalysis(createFakeDb(ROWS))
    const phrases = result.members.flatMap((member) => member.catchphrases.map((item) => item.content))

    assert.deepEqual(phrases, ['哈哈哈', '收到', '明天见'])
  })
})

describe('getLanguagePreferenceAnalysis catchphrases', () => {
  it('uses the same human catchphrase filter', () => {
    const messageRows = ROWS.flatMap((row) =>
      Array.from({ length: row.count as number }, () => ({
        memberId: row.memberId,
        name: row.name,
        content: row.content,
      }))
    )

    const result = getLanguagePreferenceAnalysis(createFakeDb(messageRows), { locale: 'zh-CN' })
    const phrases = result.members.flatMap((member: any) => member.catchphrases.map((item: any) => item.content))

    assert.deepEqual(phrases, ['哈哈哈', '收到', '明天见'])
  })
})
