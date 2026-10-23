import assert from 'node:assert/strict'
import test from 'node:test'
import type { DatabaseAdapter } from '@openchatlab/core'
import { sessionsListTool, type SessionListContext } from './sessions'

test('list_sessions closes each per-session database even when metadata query throws', () => {
  let closeCount = 0
  const fakeDb: DatabaseAdapter = {
    readonly: true,
    prepare: () => {
      throw new Error('synthetic database query failure')
    },
    pragma: () => [],
    exec: () => undefined,
    transaction: (fn) => fn(),
    close: () => {
      closeCount++
    },
  }
  const context: SessionListContext = {
    db: fakeDb,
    sessionId: '',
    listSessionIds: () => ['one'],
    openDb: () => fakeDb,
    closeDb: (db) => db.close(),
  }
  assert.throws(() => sessionsListTool.handler({}, context), /synthetic database query failure/)
  assert.equal(closeCount, 1)
})
