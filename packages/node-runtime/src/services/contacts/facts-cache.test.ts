/**
 * Run: pnpm test -- packages/node-runtime/src/services/contacts/facts-cache.test.ts
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ChatType, type ContactsTimeRangeState } from '@openchatlab/shared-types'
import { getCachePath, setCache } from '../../cache/session-cache'
import {
  buildContactsSessionFactsCacheKey,
  readCachedContactsSessionFacts,
  writeCachedContactsSessionFacts,
  type ContactsSessionFacts,
} from './facts-cache'

function makeTempDir(): string {
  const baseDir = process.env.CHATLAB_TEST_TMPDIR ?? (fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir())
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-contacts-facts-cache-'))
}

function makeTimeRange(overrides: Partial<ContactsTimeRangeState> = {}): ContactsTimeRangeState {
  return {
    preset: '1y',
    anchorTs: 1704103200,
    startTs: 1672567200,
    ...overrides,
  }
}

function makeFacts(): ContactsSessionFacts {
  return {
    kind: 'private',
    latestMessageTs: 1704103200,
    meta: {
      name: 'private-a',
      platform: 'weixin',
      type: ChatType.PRIVATE,
      ownerId: 'owner',
    },
    facts: {
      contact: {
        id: 2,
        platformId: 'alice',
        name: 'Alice',
        aliases: [],
        avatar: null,
      },
      privateMessageCount: 10,
      activeMonths: ['2024-01'],
      lastMessageTs: 1704103200,
    },
  }
}

test('contacts session facts cache key includes algorithm version, preset, and start timestamp', () => {
  const oneYear = buildContactsSessionFactsCacheKey('contacts-v1', makeTimeRange())
  const twoYears = buildContactsSessionFactsCacheKey('contacts-v1', makeTimeRange({ preset: '2y' }))
  const shiftedStart = buildContactsSessionFactsCacheKey('contacts-v1', makeTimeRange({ startTs: 1600000000 }))
  const nextAlgorithm = buildContactsSessionFactsCacheKey('contacts-v2', makeTimeRange())

  assert.notEqual(oneYear, twoYears)
  assert.notEqual(oneYear, shiftedStart)
  assert.notEqual(oneYear, nextAlgorithm)
})

test('contacts session facts cache is versioned by session db fingerprint', (t) => {
  const dir = makeTempDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const key = buildContactsSessionFactsCacheKey('contacts-v1', makeTimeRange())

  writeCachedContactsSessionFacts('session-a', dir, key, 'db-v1', makeFacts())

  assert.deepEqual(readCachedContactsSessionFacts('session-a', dir, key, 'db-v1'), {
    hit: true,
    data: makeFacts(),
  })
  assert.deepEqual(readCachedContactsSessionFacts('session-a', dir, key, 'db-v2'), { hit: false })
})

test('contacts session facts cache treats corrupt or malformed entries as misses', (t) => {
  const dir = makeTempDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const key = buildContactsSessionFactsCacheKey('contacts-v1', makeTimeRange())

  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(getCachePath('session-a', dir), '{ broken', 'utf-8')
  assert.deepEqual(readCachedContactsSessionFacts('session-a', dir, key, 'db-v1'), { hit: false })

  setCache('session-a', key, { v: 'db-v1', data: { kind: 'private', latestMessageTs: 1 } }, dir)
  assert.deepEqual(readCachedContactsSessionFacts('session-a', dir, key, 'db-v1'), { hit: false })
})
