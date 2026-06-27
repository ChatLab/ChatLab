/**
 * Tests for People relationships session facts cache helpers.
 *
 * Run: pnpm test -- packages/node-runtime/src/services/people/relationships/facts-cache.test.ts
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ChatType, type ContactsTimeRangeState } from '@openchatlab/shared-types'
import {
  buildPeopleRelationshipsSessionFactsCacheKey,
  readCachedPeopleRelationshipsSessionFacts,
  writeCachedPeopleRelationshipsSessionFacts,
} from './facts-cache'

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir(), 'chatlab-rel-cache-'))
}

const range1y: ContactsTimeRangeState = {
  preset: '1y',
  anchorTs: 1700000000,
  startTs: 1668464000,
}

const rangeAll: ContactsTimeRangeState = {
  preset: 'all',
  anchorTs: 1700000000,
  startTs: null,
}

test('stores versioned relationship facts by DB version and time range', () => {
  const dir = makeTempDir()
  try {
    const key = buildPeopleRelationshipsSessionFactsCacheKey('people-relationships-v1', range1y)
    const facts = {
      kind: 'group' as const,
      meta: {
        name: 'Group',
        platform: 'weixin',
        type: ChatType.GROUP,
        ownerId: 'owner',
      },
      latestMessageTs: 1700000000,
      facts: {
        members: [],
        edges: [],
      },
    }

    writeCachedPeopleRelationshipsSessionFacts('session-a', dir, key, 'db-v1', facts)

    assert.deepEqual(readCachedPeopleRelationshipsSessionFacts('session-a', dir, key, 'db-v1'), {
      hit: true,
      data: facts,
    })
    assert.deepEqual(readCachedPeopleRelationshipsSessionFacts('session-a', dir, key, 'db-v2'), { hit: false })
    assert.deepEqual(
      readCachedPeopleRelationshipsSessionFacts(
        'session-a',
        dir,
        buildPeopleRelationshipsSessionFactsCacheKey('people-relationships-v1', rangeAll),
        'db-v1'
      ),
      { hit: false }
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
