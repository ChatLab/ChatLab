/**
 * Run: pnpm test -- src/components/common/ChatRecord/query-session.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { preserveChatRecordSessionId, resolveChatRecordSessionId } from './query-session'

test('uses the chat record query session id before the current route session id', () => {
  assert.equal(resolveChatRecordSessionId({ sessionId: 'source-session' }, 'current-session'), 'source-session')
})

test('falls back to the current route session id when query has no session id', () => {
  assert.equal(resolveChatRecordSessionId({}, 'current-session'), 'current-session')
})

test('returns null when neither query nor route has a session id', () => {
  assert.equal(resolveChatRecordSessionId({}, null), null)
})

test('preserves the current chat record session id when applying drawer filters', () => {
  assert.deepEqual(
    preserveChatRecordSessionId({ keywords: ['refund'] }, { sessionId: 'source-session', memberName: 'Alice' }),
    { keywords: ['refund'], sessionId: 'source-session' }
  )
})

test('does not add an empty session id when the current query is not session scoped', () => {
  assert.deepEqual(preserveChatRecordSessionId({ keywords: ['refund'] }, {}), { keywords: ['refund'] })
})
