import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildMemberIdMap } from '../writers'
import type { DatabaseAdapter } from '../../interfaces'

function createMockDb(members: Array<{ id: number; platform_id: string }>): DatabaseAdapter {
  return {
    prepare: (_sql: string) => ({
      all: () => [...members],
      get: () => undefined,
      run: () => ({ changes: 0 }),
    }),
    exec: () => {},
    transaction: <T>(fn: () => T) => fn(),
    pragma: () => undefined,
    close: () => {},
  }
}

describe('buildMemberIdMap', () => {
  it('returns empty map for empty member table', () => {
    const db = createMockDb([])
    const map = buildMemberIdMap(db)
    assert.equal(map.size, 0)
  })

  it('maps platform_id to internal row id', () => {
    const db = createMockDb([
      { id: 1, platform_id: 'alice' },
      { id: 2, platform_id: 'bob' },
      { id: 3, platform_id: 'charlie' },
    ])
    const map = buildMemberIdMap(db)
    assert.equal(map.size, 3)
    assert.equal(map.get('alice'), 1)
    assert.equal(map.get('bob'), 2)
    assert.equal(map.get('charlie'), 3)
  })

  it('returns undefined for unknown platform_id', () => {
    const db = createMockDb([{ id: 1, platform_id: 'alice' }])
    const map = buildMemberIdMap(db)
    assert.equal(map.get('unknown'), undefined)
  })
})
