import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MemoryProvenanceCoordinator } from './memory-provenance-coordinator'

describe('MemoryProvenanceCoordinator', () => {
  it('keeps provenance valid for an arbitrarily long active agent turn', (t) => {
    let now = 0
    t.mock.method(Date, 'now', () => now)
    const coordinator = new MemoryProvenanceCoordinator()

    coordinator.begin('turn-token', 'global-chat')
    now = 24 * 60 * 60 * 1000
    coordinator.record('turn-token', 'memory-1')
    coordinator.complete('turn-token', 'previous-message')

    assert.deepEqual(coordinator.validate('turn-token', 'global-chat', ['memory-1']), {
      expectedParentMessageId: 'previous-message',
    })
  })

  it('removes completed turns that did not change any memories', () => {
    const coordinator = new MemoryProvenanceCoordinator()

    coordinator.begin('empty-turn', 'global-chat')
    coordinator.complete('empty-turn', null)

    assert.throws(() => coordinator.validate('empty-turn', 'global-chat', []), /Memory provenance token is invalid/)
  })

  it('keeps completed changes until they are consumed', () => {
    const coordinator = new MemoryProvenanceCoordinator()

    coordinator.begin('changed-turn', 'global-chat')
    coordinator.record('changed-turn', 'memory-1')
    coordinator.complete('changed-turn', null)

    assert.deepEqual(coordinator.validate('changed-turn', 'global-chat', ['memory-1']), {
      expectedParentMessageId: null,
    })
    coordinator.consume('changed-turn')

    assert.throws(
      () => coordinator.validate('changed-turn', 'global-chat', ['memory-1']),
      /Memory provenance token is invalid/
    )
  })
})
