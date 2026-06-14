import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { DatabaseAdapter, PreparedStatement } from '../../interfaces'
import { getLanguagePreferenceAnalysis } from './languagePreference'
import { getCatchphraseAnalysis } from './repeat'

interface MockRow {
  [key: string]: unknown
  memberId: number
  platformId?: string
  name: string
  content: string
  count?: number
}

function createRowsDb(rows: MockRow[]): DatabaseAdapter {
  return {
    prepare(): PreparedStatement {
      return {
        get() {
          return undefined
        },
        all() {
          return rows
        },
        run() {
          return { changes: 0, lastInsertRowid: 0 }
        },
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    exec() {},
    transaction<T>(fn: () => T) {
      return fn()
    },
    pragma() {
      return undefined
    },
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    close() {},
  }
}

describe('getCatchphraseAnalysis', () => {
  it('filters QQ reply placeholders from catchphrase results', () => {
    const db = createRowsDb([
      { memberId: 1, platformId: 'alice', name: 'Alice', content: '[回复消息]', count: 10 },
      { memberId: 1, platformId: 'alice', name: 'Alice', content: '收到', count: 3 },
    ])

    const result = getCatchphraseAnalysis(db)

    assert.deepEqual(result.members[0]?.catchphrases, [{ content: '收到', count: 3 }])
  })
})

describe('getLanguagePreferenceAnalysis', () => {
  it('filters QQ reply placeholders from phrase frequency results', () => {
    const db = createRowsDb([
      { memberId: 1, name: 'Alice', content: '[回复消息]' },
      { memberId: 1, name: 'Alice', content: '[回复消息]' },
      { memberId: 1, name: 'Alice', content: 'noted' },
      { memberId: 1, name: 'Alice', content: 'noted' },
    ])

    const result = getLanguagePreferenceAnalysis(db, { locale: 'en-US' })

    assert.deepEqual(result.members[0]?.catchphrases, [{ content: 'noted', count: 2 }])
  })
})
