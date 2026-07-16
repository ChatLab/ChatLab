/**
 * Run: pnpm test -- src/components/analysis/quotes/catchphrase-record-query.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCatchphraseRecordQuery } from './catchphrase-record-query'

test('keeps the selected member when opening catchphrase records', () => {
  assert.deepEqual(buildCatchphraseRecordQuery('口头禅', { memberId: 42 }), {
    keywords: ['口头禅'],
    memberId: 42,
  })
})

test('keeps overview catchphrase records scoped only by keyword', () => {
  assert.deepEqual(buildCatchphraseRecordQuery('口头禅'), {
    keywords: ['口头禅'],
  })
})
