/**
 * Unit tests for owner profile matching (deterministic "who am I" resolution).
 *
 * Run: npx tsx --test packages/core/src/owner/owner-matching.test.ts
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { OwnerProfile } from '@openchatlab/shared-types'
import {
  normalizeOwnerName,
  collectCandidateNames,
  mergeConfirmedNames,
  matchOwnerProfile,
  isNameMatchPlatform,
} from './owner-matching'

function makeProfile(overrides?: Partial<OwnerProfile>): OwnerProfile {
  return {
    platformId: 'Alice',
    displayName: 'Alice',
    confirmedNames: ['Alice'],
    matchMode: 'name',
    updatedAt: 1700000000,
    ...overrides,
  }
}

describe('normalizeOwnerName', () => {
  it('trims and collapses whitespace', () => {
    assert.equal(normalizeOwnerName('  Alice   Smith  '), 'alice smith')
  })

  it('removes invisible direction/control characters (LRM/RLM/zero-width/BOM)', () => {
    assert.equal(normalizeOwnerName('\u200EAlice\u200F'), 'alice')
    assert.equal(normalizeOwnerName('\u202AAlice\u202C'), 'alice')
    assert.equal(normalizeOwnerName('A\u200Blice'), 'alice')
    assert.equal(normalizeOwnerName('\uFEFFAlice'), 'alice')
  })

  it('applies NFKC normalization (full-width to half-width)', () => {
    assert.equal(normalizeOwnerName('Ａｌｉｃｅ　１２３'), 'alice 123')
  })

  it('lowercases for case-insensitive comparison', () => {
    assert.equal(normalizeOwnerName('ALICE'), 'alice')
  })

  it('keeps CJK names intact', () => {
    assert.equal(normalizeOwnerName(' 王小明 '), '王小明')
  })
})

describe('collectCandidateNames', () => {
  it('collects platformId, accountName, groupNickname, aliases and displayName', () => {
    const names = collectCandidateNames({
      platformId: 'u001',
      accountName: 'Alice',
      groupNickname: 'Ali',
      aliases: ['A.', 'Allie'],
      displayName: 'Ali',
    })
    assert.deepEqual(names, ['u001', 'Alice', 'Ali', 'A.', 'Allie'])
  })

  it('skips empty and whitespace-only values', () => {
    const names = collectCandidateNames({
      platformId: 'u001',
      accountName: '',
      groupNickname: '   ',
      aliases: [''],
      displayName: null,
    })
    assert.deepEqual(names, ['u001'])
  })
})

describe('mergeConfirmedNames', () => {
  it('merges member names into existing list without duplicates, preserving order', () => {
    const merged = mergeConfirmedNames(['Alice', 'Ali'], {
      platformId: 'Alice',
      accountName: 'Alice Smith',
      groupNickname: 'Ali',
      aliases: ['Allie'],
    })
    assert.deepEqual(merged, ['Alice', 'Ali', 'Alice Smith', 'Allie'])
  })

  it('keeps original strings without normalization', () => {
    const merged = mergeConfirmedNames([], { platformId: ' Alice ' })
    assert.deepEqual(merged, [' Alice '])
  })
})

describe('matchOwnerProfile', () => {
  it('matches exact platformId on any platform', () => {
    const result = matchOwnerProfile('weixin', makeProfile({ platformId: 'wx_123', confirmedNames: [] }), [
      { platformId: 'wx_123', accountName: 'Me' },
      { platformId: 'wx_456', accountName: 'Other' },
    ])
    assert.deepEqual(result, { type: 'exact', platformId: 'wx_123' })
  })

  it('falls back to name matching only on allowlisted platforms', () => {
    const members = [
      { platformId: 'Alice Smith', accountName: 'Alice Smith' },
      { platformId: 'Bob', accountName: 'Bob' },
    ]
    const profile = makeProfile({ platformId: 'Alice', confirmedNames: ['alice  smith'] })

    assert.deepEqual(matchOwnerProfile('whatsapp', profile, members), {
      type: 'name',
      platformId: 'Alice Smith',
    })
    // weixin has stable IDs; no name fallback
    assert.deepEqual(matchOwnerProfile('weixin', profile, members), { type: 'none' })
    // unknown platform never uses name fallback
    assert.deepEqual(matchOwnerProfile('unknown', profile, members), { type: 'none' })
  })

  it('matches names with invisible characters and width differences', () => {
    const result = matchOwnerProfile('whatsapp', makeProfile({ confirmedNames: ['Ａｌｉｃｅ'] }), [
      { platformId: '\u200EAlice\u200F' },
      { platformId: 'Bob' },
    ])
    assert.deepEqual(result, { type: 'name', platformId: '\u200EAlice\u200F' })
  })

  it('matches via aliases and groupNickname', () => {
    const result = matchOwnerProfile('line', makeProfile({ platformId: 'Allie W', confirmedNames: ['Allie'] }), [
      { platformId: 'Alice', accountName: 'Alice', aliases: ['Allie'] },
      { platformId: 'Bob' },
    ])
    assert.deepEqual(result, { type: 'name', platformId: 'Alice' })
  })

  it('returns ambiguous when multiple members match', () => {
    const result = matchOwnerProfile('whatsapp', makeProfile({ confirmedNames: ['Alice'] }), [
      { platformId: 'u1', accountName: 'Alice' },
      { platformId: 'u2', groupNickname: 'Alice' },
    ])
    assert.equal(result.type, 'ambiguous')
    assert.deepEqual(result.type === 'ambiguous' ? result.platformIds : [], ['u1', 'u2'])
  })

  it('returns none when nothing matches or confirmed names are empty', () => {
    const members = [{ platformId: 'Bob' }]
    assert.deepEqual(matchOwnerProfile('whatsapp', makeProfile({ confirmedNames: ['Alice'] }), members), {
      type: 'none',
    })
    assert.deepEqual(matchOwnerProfile('whatsapp', makeProfile({ confirmedNames: ['  '] }), members), {
      type: 'none',
    })
  })

  it('does not use substring containment', () => {
    const result = matchOwnerProfile('whatsapp', makeProfile({ confirmedNames: ['Alice'] }), [
      { platformId: 'Alice Smith' },
    ])
    assert.deepEqual(result, { type: 'none' })
  })
})

describe('isNameMatchPlatform', () => {
  it('only allows whatsapp, line and instagram', () => {
    assert.equal(isNameMatchPlatform('whatsapp'), true)
    assert.equal(isNameMatchPlatform('line'), true)
    assert.equal(isNameMatchPlatform('instagram'), true)
    assert.equal(isNameMatchPlatform('weixin'), false)
    assert.equal(isNameMatchPlatform('qq'), false)
    assert.equal(isNameMatchPlatform('telegram'), false)
    assert.equal(isNameMatchPlatform('unknown'), false)
  })
})
