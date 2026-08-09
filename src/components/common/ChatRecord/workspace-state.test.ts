/**
 * Run: pnpm test -- src/components/common/ChatRecord/workspace-state.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveChatRecordIndexAction, type ChatRecordIndexState } from './workspace-state'

test('only allows index generation after confirming the index is missing', () => {
  const cases: Array<{ state: ChatRecordIndexState; action: ReturnType<typeof resolveChatRecordIndexAction> }> = [
    { state: 'loading', action: null },
    { state: 'ready', action: null },
    { state: 'missing', action: 'generate' },
    { state: 'error', action: 'retry' },
  ]

  for (const { state, action } of cases) {
    assert.equal(resolveChatRecordIndexAction(state), action, state)
  }
})
