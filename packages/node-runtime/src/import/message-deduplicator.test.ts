import assert from 'node:assert/strict'
import test from 'node:test'
import { createMessageDedupState, registerMessageAndCheckDuplicate, type DedupMessage } from './message-deduplicator'

const baseMessage: Omit<DedupMessage, 'platformMessageId'> = {
  timestamp: 1780330832,
  senderPlatformId: 'wxid_alice',
  type: 0,
  content: 'same message',
}

test('deduplicates mixed platform-id copies in either order', () => {
  const idFirst = createMessageDedupState()
  assert.equal(registerMessageAndCheckDuplicate({ ...baseMessage, platformMessageId: 'msg-1' }, idFirst), false)
  assert.equal(registerMessageAndCheckDuplicate(baseMessage, idFirst), true)

  const fallbackFirst = createMessageDedupState()
  assert.equal(registerMessageAndCheckDuplicate(baseMessage, fallbackFirst), false)
  assert.equal(registerMessageAndCheckDuplicate({ ...baseMessage, platformMessageId: 'msg-1' }, fallbackFirst), true)
})

test('preserves distinct platform IDs that share the same fallback key', () => {
  const state = createMessageDedupState()

  assert.equal(registerMessageAndCheckDuplicate({ ...baseMessage, platformMessageId: 'msg-1' }, state), false)
  assert.equal(registerMessageAndCheckDuplicate({ ...baseMessage, platformMessageId: 'msg-2' }, state), false)
})

test('bridges one fallback-only copy without collapsing later distinct platform IDs', () => {
  const state = createMessageDedupState()

  assert.equal(registerMessageAndCheckDuplicate(baseMessage, state), false)
  assert.equal(registerMessageAndCheckDuplicate({ ...baseMessage, platformMessageId: 'msg-1' }, state), true)
  assert.equal(registerMessageAndCheckDuplicate({ ...baseMessage, platformMessageId: 'msg-2' }, state), false)
})

test('preserves repeated fallback occurrences when multiplicity is enabled', () => {
  const state = createMessageDedupState([], [], [], { preserveFallbackMultiplicity: true })

  assert.equal(registerMessageAndCheckDuplicate(baseMessage, state), false)
  assert.equal(registerMessageAndCheckDuplicate(baseMessage, state), false)
})

test('bridges fallback-only and stable-ID occurrences one for one', () => {
  const fallbackFirst = createMessageDedupState([], [], [], { preserveFallbackMultiplicity: true })
  assert.equal(registerMessageAndCheckDuplicate(baseMessage, fallbackFirst), false)
  assert.equal(registerMessageAndCheckDuplicate(baseMessage, fallbackFirst), false)
  assert.equal(registerMessageAndCheckDuplicate({ ...baseMessage, platformMessageId: 'msg-1' }, fallbackFirst), true)
  assert.equal(registerMessageAndCheckDuplicate({ ...baseMessage, platformMessageId: 'msg-2' }, fallbackFirst), true)
  assert.equal(registerMessageAndCheckDuplicate({ ...baseMessage, platformMessageId: 'msg-3' }, fallbackFirst), false)

  const stableFirst = createMessageDedupState([], [], [], { preserveFallbackMultiplicity: true })
  assert.equal(registerMessageAndCheckDuplicate({ ...baseMessage, platformMessageId: 'msg-1' }, stableFirst), false)
  assert.equal(registerMessageAndCheckDuplicate({ ...baseMessage, platformMessageId: 'msg-2' }, stableFirst), false)
  assert.equal(registerMessageAndCheckDuplicate(baseMessage, stableFirst), true)
  assert.equal(registerMessageAndCheckDuplicate(baseMessage, stableFirst), true)
  assert.equal(registerMessageAndCheckDuplicate(baseMessage, stableFirst), false)
})
