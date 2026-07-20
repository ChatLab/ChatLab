import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./SessionInsights.vue', import.meta.url), 'utf8')

test('keeps member filter invalidation scoped to the active insight subtree', () => {
  assert.equal(source.includes('abortAnalyticsRequests'), false)
  assert.equal(source.match(/:key="selectedMemberId \?\? 'all'"/g)?.length, 3)
})
