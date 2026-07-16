/**
 * Integration tests for the cross-session contacts service.
 *
 * Run: pnpm test -- packages/node-runtime/src/services/contacts/service.test.ts
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { CHAT_DB_SCHEMA } from '@openchatlab/core'
import type { DatabaseAdapter, PathProvider } from '@openchatlab/core'
import { ChatType } from '@openchatlab/shared-types'
import type { ContactItem, ContactsResponse, ContactsTimeRangePreset } from '@openchatlab/shared-types'
import { openBetterSqliteDatabase } from '../../better-sqlite3-adapter'
import type { SessionRuntimeAdapter } from '../adapters'
import { CONTACTS_ALGORITHM_VERSION, computeContactsSnapshot, type ContactsSnapshot } from './compute'
import { createContactsService } from './service'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

function makeTempDir(): string {
  const baseDir = process.env.CHATLAB_TEST_TMPDIR ?? (fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir())
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-contacts-service-'))
}

interface SeedMember {
  id: number
  platformId: string
  accountName?: string
  groupNickname?: string
  aliases?: string[]
  avatar?: string | null
}

interface SeedMessage {
  id: number
  senderId: number
  ts: number
  content?: string
  platformMessageId?: string | null
  replyToMessageId?: string | null
}

interface SeedSession {
  id: string
  platform: string
  type: 'private' | 'group'
  ownerId?: string | null
  members: SeedMember[]
  messages?: SeedMessage[]
}

class TestEnv {
  readonly dir = makeTempDir()
  readonly adapter: SessionRuntimeAdapter
  private dbPaths = new Map<string, string>()
  private openDbs: DatabaseAdapter[] = []

  constructor() {
    const open = (sessionId: string, readonly: boolean): DatabaseAdapter | null => {
      const dbPath = this.dbPaths.get(sessionId)
      if (!dbPath) return null
      const db = openBetterSqliteDatabase(dbPath, { readonly, nativeBinding })
      this.openDbs.push(db)
      return db
    }

    this.adapter = {
      listSessionIds: () => [...this.dbPaths.keys()],
      openReadonly: (id) => open(id, true),
      openWritable: (id) => open(id, false),
      closeSession: () => {},
      getDbPath: (id) => this.dbPaths.get(id) ?? '',
      deleteSessionFile: () => false,
      ensureReadonly: (id) => {
        const db = open(id, true)
        if (!db) throw Object.assign(new Error(`Session not found: ${id}`), { statusCode: 404 })
        return db
      },
      ensureWritable: (id) => {
        const db = open(id, false)
        if (!db) throw Object.assign(new Error(`Session not found: ${id}`), { statusCode: 404 })
        return db
      },
    }
  }

  seed(session: SeedSession): void {
    const dbPath = path.join(this.dir, `${session.id}.db`)
    const db = openBetterSqliteDatabase(dbPath, { nativeBinding })
    db.exec(CHAT_DB_SCHEMA)
    db.prepare(`INSERT INTO meta (name, platform, type, imported_at, owner_id) VALUES (?, ?, ?, ?, ?)`).run(
      session.id,
      session.platform,
      session.type,
      1780000000,
      session.ownerId ?? null
    )
    for (const member of session.members) {
      db.prepare(
        `INSERT INTO member (id, platform_id, account_name, group_nickname, aliases, avatar) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        member.id,
        member.platformId,
        member.accountName ?? member.platformId,
        member.groupNickname ?? null,
        JSON.stringify(member.aliases ?? []),
        member.avatar ?? null
      )
    }
    for (const message of session.messages ?? []) {
      db.prepare(
        `INSERT INTO message
          (id, sender_id, ts, type, content, platform_message_id, reply_to_message_id)
         VALUES (?, ?, ?, 0, ?, ?, ?)`
      ).run(
        message.id,
        message.senderId,
        message.ts,
        message.content ?? `message ${message.id}`,
        message.platformMessageId ?? `m-${message.id}`,
        message.replyToMessageId ?? null
      )
    }
    db.close()
    this.dbPaths.set(session.id, dbPath)
  }

  dbPath(sessionId: string): string {
    const dbPath = this.dbPaths.get(sessionId)
    assert.ok(dbPath)
    return dbPath
  }

  pathProvider(options: { systemDir?: string; userDataDir?: string } = {}): PathProvider {
    const systemDir = options.systemDir ?? this.dir
    const userDataDir = options.userDataDir ?? this.dir
    return {
      getSystemDir: () => systemDir,
      getUserDataDir: () => userDataDir,
      getDatabaseDir: () => userDataDir,
      getVectorDir: () => path.join(userDataDir, 'vector'),
      getAiDataDir: () => path.join(systemDir, 'ai'),
      getSettingsDir: () => path.join(systemDir, 'settings'),
      getCacheDir: () => path.join(systemDir, 'cache'),
      getTempDir: () => path.join(systemDir, 'temp'),
      getLogsDir: () => path.join(systemDir, 'logs'),
      getDownloadsDir: () => path.join(systemDir, 'downloads'),
    }
  }

  cleanup(): void {
    for (const db of this.openDbs) {
      try {
        db.close()
      } catch {
        // already closed
      }
    }
    fs.rmSync(this.dir, { recursive: true, force: true })
  }
}

function privateMessages(count: number, startId: number, startTs: number): SeedMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: startId + index,
    senderId: index % 2 === 0 ? 1 : 2,
    ts: startTs + index,
  }))
}

test('aggregates stable-id contacts across private and group sessions', (t) => {
  const env = new TestEnv()
  t.after(() => env.cleanup())

  env.seed({
    id: 'private-a',
    platform: 'weixin',
    type: 'private',
    ownerId: 'owner',
    members: [
      { id: 1, platformId: 'owner', accountName: 'Me' },
      { id: 2, platformId: 'alice', accountName: 'Alice', aliases: ['Ally'], avatar: 'alice.png' },
    ],
    messages: privateMessages(60, 1, 1704103200),
  })
  env.seed({
    id: 'private-b',
    platform: 'weixin',
    type: 'private',
    ownerId: 'owner',
    members: [
      { id: 1, platformId: 'owner', accountName: 'Me' },
      { id: 2, platformId: 'alice', accountName: 'Alice B' },
    ],
    messages: privateMessages(5, 1, 1706781600),
  })
  env.seed({
    id: 'group-a',
    platform: 'weixin',
    type: 'group',
    ownerId: 'owner',
    members: [
      { id: 1, platformId: 'owner', accountName: 'Me' },
      { id: 2, platformId: 'alice', accountName: 'Alice' },
      { id: 3, platformId: 'bob', accountName: 'Bob' },
    ],
    messages: [
      { id: 1, senderId: 1, ts: 1704103200, platformMessageId: 'owner-1' },
      { id: 2, senderId: 2, ts: 1704103201, platformMessageId: 'alice-1', replyToMessageId: 'owner-1' },
      { id: 3, senderId: 3, ts: 1704103800, platformMessageId: 'bob-1' },
    ],
  })

  const result = computeContactsSnapshot({ adapter: env.adapter, signature: 'sig-1' })
  const byKey = new Map(result.contacts.map((contact) => [contact.key, contact]))
  const alice = byKey.get('weixin:alice')
  const bob = byKey.get('weixin:bob')

  assert.ok(alice)
  assert.equal(alice.isFriend, true)
  assert.equal(alice.pool, 'friend')
  assert.equal(alice.scoreBreakdown.privateMessageCount, 65)
  assert.equal(alice.scoreBreakdown.activePrivateMonths, 2)
  assert.equal(alice.scoreBreakdown.commonGroupCount, 1)
  assert.equal(alice.avatar, 'alice.png')
  assert.ok(alice.aliases.includes('Ally'))
  assert.ok(alice.searchText.includes('ally'))
  assert.deepEqual(alice.sourceSessions.map((source) => source.id).sort(), ['group-a', 'private-a', 'private-b'])

  assert.ok(bob)
  assert.equal(bob.isFriend, false)
  assert.equal(bob.pool, 'non_friend')
  assert.equal(bob.scoreBreakdown.commonGroupCount, 1)
  assert.equal(bob.sourceSessions.length, 1)

  assert.equal(result.diagnostics.privateSessionCount, 2)
  assert.equal(result.diagnostics.contactsEnabled, true)
})

test('records diagnostics for missing owner, unresolved owner, and ambiguous private sessions', (t) => {
  const env = new TestEnv()
  t.after(() => env.cleanup())

  env.seed({
    id: 'missing-owner',
    platform: 'weixin',
    type: 'private',
    ownerId: null,
    members: [{ id: 1, platformId: 'alice' }],
  })
  env.seed({
    id: 'unresolved-owner',
    platform: 'weixin',
    type: 'private',
    ownerId: 'owner',
    members: [{ id: 1, platformId: 'alice' }],
  })
  env.seed({
    id: 'ambiguous-private',
    platform: 'weixin',
    type: 'private',
    ownerId: 'owner',
    members: [
      { id: 1, platformId: 'owner' },
      { id: 2, platformId: 'alice' },
      { id: 3, platformId: 'bob' },
    ],
  })

  const result = computeContactsSnapshot({ adapter: env.adapter, signature: 'sig-1' })

  assert.equal(result.contacts.length, 0)
  assert.equal(result.diagnostics.privateSessionCount, 3)
  assert.equal(result.diagnostics.skippedMissingOwnerSessions, 1)
  assert.equal(result.diagnostics.skippedUnresolvedOwnerSessions, 1)
  assert.equal(result.diagnostics.skippedAmbiguousPrivateSessions, 1)
})

test('keeps name-match platform contacts session-scoped', (t) => {
  const env = new TestEnv()
  t.after(() => env.cleanup())

  for (const id of ['whatsapp-a', 'whatsapp-b']) {
    env.seed({
      id,
      platform: 'whatsapp',
      type: 'private',
      ownerId: 'Me',
      members: [
        { id: 1, platformId: 'Me' },
        { id: 2, platformId: 'Alice' },
      ],
      messages: privateMessages(10, 1, 1704103200),
    })
  }

  const result = computeContactsSnapshot({ adapter: env.adapter, signature: 'sig-1' })
  const keys = result.contacts.map((contact) => contact.key).sort()

  assert.deepEqual(keys, ['whatsapp:whatsapp-a:Alice', 'whatsapp:whatsapp-b:Alice'])
})

test('keeps QQ nickname fallback contacts session-scoped', (t) => {
  const env = new TestEnv()
  t.after(() => env.cleanup())

  for (const id of ['qq-group-a', 'qq-group-b']) {
    env.seed({
      id,
      platform: 'qq',
      type: 'group',
      ownerId: 'owner',
      members: [
        { id: 1, platformId: 'owner', accountName: 'Owner' },
        { id: 2, platformId: 'Alice', accountName: 'Alice' },
      ],
      messages: [
        { id: 1, senderId: 1, ts: 1704103200, platformMessageId: `${id}-owner-1` },
        { id: 2, senderId: 2, ts: 1704103201, platformMessageId: `${id}-alice-1` },
      ],
    })
  }

  const result = computeContactsSnapshot({ adapter: env.adapter, signature: 'sig-1' })
  const keys = result.contacts.map((contact) => contact.key).sort()

  assert.deepEqual(keys, ['qq:qq-group-a:Alice', 'qq:qq-group-b:Alice'])
})

test('sorts non-friends by score with the public contacts response shape', (t) => {
  const env = new TestEnv()
  t.after(() => env.cleanup())

  env.seed({
    id: 'private-a',
    platform: 'weixin',
    type: 'private',
    ownerId: 'owner',
    members: [
      { id: 1, platformId: 'owner' },
      { id: 2, platformId: 'alice' },
    ],
    messages: privateMessages(60, 1, 1704103200),
  })
  env.seed({
    id: 'group-a',
    platform: 'weixin',
    type: 'group',
    ownerId: 'owner',
    members: [
      { id: 1, platformId: 'owner' },
      { id: 2, platformId: 'alice' },
      { id: 3, platformId: 'bob' },
    ],
    messages: [
      { id: 1, senderId: 1, ts: 1704103200, platformMessageId: 'owner-1' },
      { id: 2, senderId: 3, ts: 1704103201, platformMessageId: 'bob-1' },
    ],
  })

  const result = computeContactsSnapshot({ adapter: env.adapter, signature: 'sig-1' })

  assert.deepEqual(
    result.contacts.map((contact) => contact.key),
    ['weixin:alice', 'weixin:bob']
  )
  assert.deepEqual(Object.keys(result.contacts[1]).sort(), [
    'aliases',
    'avatar',
    'displayName',
    'isFriend',
    'key',
    'lastInteractionTs',
    'platform',
    'platformId',
    'pool',
    'score',
    'scoreBreakdown',
    'searchText',
    'sessionId',
    'sessionScoped',
    'sourceSessions',
  ])
  assert.deepEqual(Object.keys(result.diagnostics).sort(), [
    'activePrivateSessionCount',
    'contactsEnabled',
    'privateSessionCount',
    'skippedAmbiguousPrivateSessions',
    'skippedFailedSessions',
    'skippedInvalidPlatformIdMembers',
    'skippedMissingOwnerSessions',
    'skippedUnresolvedOwnerSessions',
    'warnings',
  ])
})

test('reuses cached contacts session facts for unchanged sessions during recompute', (t) => {
  const env = new TestEnv()
  t.after(() => env.cleanup())
  const factsCacheDir = path.join(env.dir, 'contacts', 'facts')

  env.seed({
    id: 'private-a',
    platform: 'weixin',
    type: 'private',
    ownerId: 'owner',
    members: [
      { id: 1, platformId: 'owner' },
      { id: 2, platformId: 'alice' },
    ],
    messages: privateMessages(20, 1, 1704103200),
  })
  env.seed({
    id: 'group-a',
    platform: 'weixin',
    type: 'group',
    ownerId: 'owner',
    members: [
      { id: 1, platformId: 'owner' },
      { id: 2, platformId: 'alice' },
      { id: 3, platformId: 'bob' },
    ],
    messages: [
      { id: 1, senderId: 1, ts: 1704103200, platformMessageId: 'owner-1' },
      { id: 2, senderId: 3, ts: 1704103201, platformMessageId: 'bob-1' },
    ],
  })

  computeContactsSnapshot({ adapter: env.adapter, signature: 'sig-1', factsCacheDir })

  const future = new Date(Date.now() + 10_000)
  fs.utimesSync(env.dbPath('private-a'), future, future)

  const openedSessionIds: string[] = []
  const countingAdapter: SessionRuntimeAdapter = {
    ...env.adapter,
    openReadonly: (sessionId) => {
      openedSessionIds.push(sessionId)
      return env.adapter.openReadonly(sessionId)
    },
  }

  const result = computeContactsSnapshot({ adapter: countingAdapter, signature: 'sig-2', factsCacheDir })

  assert.equal(openedSessionIds.includes('private-a'), true)
  assert.equal(openedSessionIds.includes('group-a'), false)
  assert.ok(result.contacts.some((contact) => contact.key === 'weixin:bob'))
})

test('does not cache contacts session facts under a db version that changed during compute', (t) => {
  const env = new TestEnv()
  t.after(() => env.cleanup())
  const factsCacheDir = path.join(env.dir, 'contacts', 'facts')

  env.seed({
    id: 'group-a',
    platform: 'weixin',
    type: 'group',
    ownerId: 'owner',
    members: [
      { id: 1, platformId: 'owner' },
      { id: 2, platformId: 'bob' },
    ],
    messages: [
      { id: 1, senderId: 1, ts: 1704103200, platformMessageId: 'owner-1' },
      { id: 2, senderId: 2, ts: 1704103201, platformMessageId: 'bob-1' },
    ],
  })

  let getDbPathCalls = 0
  const racingAdapter: SessionRuntimeAdapter = {
    ...env.adapter,
    getDbPath: (sessionId) => {
      getDbPathCalls++
      const dbPath = env.adapter.getDbPath(sessionId)
      if (sessionId === 'group-a' && getDbPathCalls === 4) {
        const future = new Date(Date.now() + 20_000)
        fs.utimesSync(dbPath, future, future)
      }
      return dbPath
    },
  }

  computeContactsSnapshot({ adapter: racingAdapter, signature: 'sig-1', factsCacheDir })

  const openedSessionIds: string[] = []
  const countingAdapter: SessionRuntimeAdapter = {
    ...env.adapter,
    openReadonly: (sessionId) => {
      openedSessionIds.push(sessionId)
      return env.adapter.openReadonly(sessionId)
    },
  }

  computeContactsSnapshot({ adapter: countingAdapter, signature: 'sig-2', factsCacheDir })

  assert.deepEqual(openedSessionIds, ['group-a', 'group-a'])
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function waitForTaskSettled(
  service: {
    getContacts: (options?: { acceptStale?: boolean; timeRangePreset?: ContactsTimeRangePreset }) => ContactsResponse
  },
  options: { timeRangePreset?: ContactsTimeRangePreset } = {}
) {
  for (let i = 0; i < 100; i++) {
    const response = service.getContacts({ acceptStale: true, timeRangePreset: options.timeRangePreset })
    if (response.task?.status !== 'running') return response
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return service.getContacts({ acceptStale: true, timeRangePreset: options.timeRangePreset })
}

function makeRuntimeSnapshot(
  signature: string,
  computedAt: number,
  timeRangePreset: ContactsTimeRangePreset = '1y'
): ContactsSnapshot {
  return {
    contacts: [
      {
        key: 'weixin:alice',
        platform: 'weixin',
        platformId: 'alice',
        sessionScoped: false,
        displayName: 'Alice',
        aliases: [],
        avatar: null,
        isFriend: true,
        pool: 'friend',
        score: 1,
        scoreBreakdown: {},
        sourceSessions: [
          {
            id: 'private-a',
            name: 'private-a',
            platform: 'weixin',
            type: ChatType.PRIVATE,
          },
        ],
        searchText: 'alice',
        lastInteractionTs: null,
      },
    ],
    diagnostics: {
      privateSessionCount: 1,
      activePrivateSessionCount: 1,
      contactsEnabled: false,
      skippedMissingOwnerSessions: 0,
      skippedUnresolvedOwnerSessions: 0,
      skippedAmbiguousPrivateSessions: 0,
      skippedInvalidPlatformIdMembers: 0,
      skippedFailedSessions: 0,
      warnings: [],
    },
    algorithmVersion: CONTACTS_ALGORITHM_VERSION,
    signature,
    timeRange: {
      preset: timeRangePreset,
      anchorTs: null,
      startTs: null,
    },
    computedAt,
    workerStats: {
      durationMs: 10,
      totalSessions: 1,
      processedSessions: 1,
      skippedFailedSessions: 0,
    },
  }
}

function makeContact(overrides: Partial<ContactItem> & Pick<ContactItem, 'key' | 'displayName' | 'pool'>): ContactItem {
  return {
    key: overrides.key,
    platform: 'weixin',
    platformId: overrides.key.split(':').at(-1) ?? overrides.key,
    sessionScoped: false,
    displayName: overrides.displayName,
    aliases: overrides.aliases ?? [],
    avatar: null,
    isFriend: overrides.pool === 'friend',
    pool: overrides.pool,
    score: overrides.score ?? 0,
    scoreBreakdown: overrides.scoreBreakdown ?? {},
    sourceSessions: overrides.sourceSessions ?? [
      {
        id: `${overrides.key}-source`,
        name: `${overrides.displayName} Source`,
        platform: 'weixin',
        type: overrides.pool === 'friend' ? ChatType.PRIVATE : ChatType.GROUP,
      },
    ],
    searchText:
      overrides.searchText ??
      [overrides.displayName, overrides.key, ...(overrides.aliases ?? [])].join(' ').toLowerCase(),
    lastInteractionTs: overrides.lastInteractionTs ?? null,
  }
}

test('returns paginated lightweight contacts from a snapshot with full-snapshot search', (t) => {
  const env = new TestEnv()
  t.after(() => env.cleanup())
  const service = createContactsService({
    adapter: env.adapter,
    systemDir: env.dir,
    runner: () => Promise.reject(new Error('not used')),
  })
  const snapshot = makeRuntimeSnapshot('sig-1', 1000)
  snapshot.contacts = [
    makeContact({ key: 'weixin:alice', displayName: 'Alice', pool: 'friend', score: 1 }),
    makeContact({ key: 'weixin:bob', displayName: 'Bob', pool: 'non_friend', score: 0.8, aliases: ['Builder'] }),
    makeContact({ key: 'weixin:carol', displayName: 'Carol', pool: 'non_friend', score: 0.7 }),
  ]
  service.replaceSnapshotForTests!(snapshot)

  const response = (service as any).getContactsPage({
    acceptStale: true,
    pool: 'non_friend',
    page: 1,
    pageSize: 1,
    query: 'build',
  })

  assert.equal(response.cache.status, 'stale')
  assert.deepEqual(response.pagination, { page: 1, pageSize: 1, total: 1, hasMore: false })
  assert.deepEqual(response.stats, { friendsTotal: 1, nonFriendsTotal: 2 })
  assert.equal(response.contacts.length, 1)
  assert.equal(response.contacts[0].key, 'weixin:bob')
  assert.equal('sourceSessions' in response.contacts[0], false)
})

test('applies manual friend overrides to paginated lists, stats, search, and detail without changing the snapshot', (t) => {
  const env = new TestEnv()
  t.after(() => env.cleanup())
  const service = createContactsService({
    adapter: env.adapter,
    systemDir: env.dir,
    runner: () => Promise.reject(new Error('not used')),
  })
  const snapshot = makeRuntimeSnapshot('sig-1', 1000)
  snapshot.contacts = [
    makeContact({ key: 'weixin:bob', displayName: 'Bob', pool: 'non_friend', score: 1, aliases: ['Builder'] }),
    makeContact({ key: 'weixin:alice', displayName: 'Alice', pool: 'friend', score: 0.4 }),
    makeContact({ key: 'weixin:carol', displayName: 'Carol', pool: 'non_friend', score: 0.3 }),
  ]
  service.replaceSnapshotForTests!(snapshot)

  assert.deepEqual((service as any).markContactAsFriend('weixin:bob', { acceptStale: true }), { success: true })

  const friends = service.getContactsPage({ acceptStale: true, pool: 'friend', page: 1, pageSize: 10 })
  assert.deepEqual(
    friends.contacts.map((contact) => contact.key),
    ['weixin:alice', 'weixin:bob']
  )
  assert.deepEqual(friends.stats, { friendsTotal: 2, nonFriendsTotal: 1 })
  assert.equal((friends.contacts[0] as any).friendSource, 'private')
  assert.equal((friends.contacts[1] as any).friendSource, 'manual')
  assert.equal(friends.contacts[1].pool, 'friend')
  assert.equal(friends.contacts[1].isFriend, true)

  const groupmates = service.getContactsPage({ acceptStale: true, pool: 'non_friend', page: 1, pageSize: 10 })
  assert.deepEqual(
    groupmates.contacts.map((contact) => contact.key),
    ['weixin:carol']
  )

  const search = service.getContactsPage({
    acceptStale: true,
    pool: 'friend',
    page: 1,
    pageSize: 10,
    query: 'build',
  })
  assert.deepEqual(
    search.contacts.map((contact) => contact.key),
    ['weixin:bob']
  )

  const detail = service.getContactDetail('weixin:bob', { acceptStale: true })
  assert.equal(detail.contact?.pool, 'friend')
  assert.equal(detail.contact?.isFriend, true)
  assert.equal((detail.contact as any).friendSource, 'manual')
  assert.equal(snapshot.contacts[0]?.pool, 'non_friend')

  assert.deepEqual((service as any).unmarkContactAsFriend('weixin:bob'), { success: true })
  const friendsAfterUnmark = service.getContactsPage({ acceptStale: true, pool: 'friend', page: 1, pageSize: 10 })
  assert.deepEqual(
    friendsAfterUnmark.contacts.map((contact) => contact.key),
    ['weixin:alice']
  )
  const groupmatesAfterUnmark = service.getContactsPage({
    acceptStale: true,
    pool: 'non_friend',
    page: 1,
    pageSize: 10,
  })
  assert.deepEqual(
    groupmatesAfterUnmark.contacts.map((contact) => contact.key),
    ['weixin:bob', 'weixin:carol']
  )
  assert.equal((groupmatesAfterUnmark.contacts[0] as any).friendSource, undefined)
})

test('returns full contact detail from the selected time range snapshot', (t) => {
  const env = new TestEnv()
  t.after(() => env.cleanup())
  const service = createContactsService({
    adapter: env.adapter,
    systemDir: env.dir,
    runner: () => Promise.reject(new Error('not used')),
  })
  const snapshot = makeRuntimeSnapshot('sig-1', 1000, '2y')
  snapshot.contacts = [
    makeContact({
      key: 'weixin:alice',
      displayName: 'Alice',
      pool: 'friend',
      sourceSessions: [
        { id: 'private-a', name: 'Private A', platform: 'weixin', type: ChatType.PRIVATE, privateMessageCount: 30 },
      ],
    }),
  ]
  service.replaceSnapshotForTests!(snapshot)

  const response = (service as any).getContactDetail('weixin:alice', { acceptStale: true, timeRangePreset: '2y' })

  assert.equal(response.contact.key, 'weixin:alice')
  assert.equal(response.contact.sourceSessions.length, 1)
  assert.equal(response.cache.status, 'stale')
  assert.equal(response.timeRange.preset, '2y')
})

test('returns missing snapshot and starts a background contacts task without synchronous compute', async (t) => {
  const env = new TestEnv()
  t.after(() => env.cleanup())
  let now = 1000

  env.seed({
    id: 'private-a',
    platform: 'weixin',
    type: 'private',
    ownerId: 'owner',
    members: [
      { id: 1, platformId: 'owner' },
      { id: 2, platformId: 'alice' },
    ],
    messages: privateMessages(5, 1, 1704103200),
  })

  const pending = deferred<ContactsSnapshot>()
  let runCalls = 0
  let runnerSignature = ''
  const service = createContactsService({
    adapter: env.adapter,
    systemDir: env.dir,
    now: () => now,
    runner: ({ signature }) => {
      runCalls++
      runnerSignature = signature
      return pending.promise
    },
  })

  const first = service.getContacts({ acceptStale: true })

  assert.equal(runCalls, 1)
  assert.match(runnerSignature, /range:1y/)
  assert.equal(first.cache.status, 'missing')
  assert.equal(first.contacts.length, 0)
  assert.equal(first.task?.status, 'running')
  assert.equal(first.task?.timeRangePreset, '1y')

  now = 2000
  pending.resolve(makeRuntimeSnapshot(runnerSignature, now))
  const finished = await waitForTaskSettled(service)

  assert.equal(finished.cache.status, 'fresh')
  assert.equal(finished.cache.computedAt, 2000)
  assert.equal(finished.contacts[0].key, 'weixin:alice')
  assert.equal(finished.timeRange.preset, '1y')
  assert.equal(finished.task?.status, 'succeeded')
})

test('keeps contacts snapshots isolated by time range preset', async (t) => {
  const env = new TestEnv()
  t.after(() => env.cleanup())

  env.seed({
    id: 'private-a',
    platform: 'weixin',
    type: 'private',
    ownerId: 'owner',
    members: [
      { id: 1, platformId: 'owner' },
      { id: 2, platformId: 'alice' },
    ],
    messages: privateMessages(5, 1, 1704103200),
  })

  const pending = deferred<ContactsSnapshot>()
  let runnerSignature = ''
  let runnerRange = ''
  const service = createContactsService({
    adapter: env.adapter,
    systemDir: env.dir,
    runner: ({ signature, timeRangePreset }) => {
      runnerSignature = signature
      runnerRange = timeRangePreset
      return pending.promise
    },
  })

  const first = service.getContacts({ acceptStale: true, timeRangePreset: '2y' })
  assert.equal(first.task?.timeRangePreset, '2y')
  assert.equal(runnerRange, '2y')
  assert.match(runnerSignature, /range:2y/)

  pending.resolve(makeRuntimeSnapshot(runnerSignature, 2000, '2y'))
  const finished = await waitForTaskSettled(service, { timeRangePreset: '2y' })

  assert.equal(finished.cache.status, 'fresh')
  assert.equal(finished.timeRange.preset, '2y')
  assert.ok(fs.existsSync(path.join(env.dir, 'contacts-snapshot-2y.json')))
  assert.equal(fs.existsSync(path.join(env.dir, 'contacts-snapshot-1y.json')), false)
})

test('returns stale snapshot and reuses one in-flight task after signature changes', async (t) => {
  const env = new TestEnv()
  t.after(() => env.cleanup())
  let now = 1000

  env.seed({
    id: 'private-a',
    platform: 'weixin',
    type: 'private',
    ownerId: 'owner',
    members: [
      { id: 1, platformId: 'owner' },
      { id: 2, platformId: 'alice' },
    ],
    messages: privateMessages(5, 1, 1704103200),
  })

  const firstSnapshot = computeContactsSnapshot({ adapter: env.adapter, signature: 'old-signature', now: () => now })
  const pending = deferred<ContactsSnapshot>()
  let runCalls = 0
  const service = createContactsService({
    adapter: env.adapter,
    systemDir: env.dir,
    now: () => now,
    runner: () => {
      runCalls++
      return pending.promise
    },
  })
  service.replaceSnapshotForTests!(firstSnapshot)

  now = 2000
  fs.utimesSync(env.dbPath('private-a'), new Date(), new Date(Date.now() + 5000))

  const freshOnly = service.getContacts()
  const stale = service.getContacts({ acceptStale: true })
  const recompute = service.startRecompute()

  assert.equal(runCalls, 1)
  assert.equal(freshOnly.cache.status, 'stale')
  assert.equal(freshOnly.contacts.length, 0)
  assert.equal(freshOnly.diagnostics.privateSessionCount, 0)
  assert.equal(stale.cache.status, 'stale')
  assert.equal(stale.contacts[0].key, 'weixin:alice')
  assert.equal(stale.task?.status, 'running')
  assert.equal(recompute.task?.status, 'running')
})

test('does not reuse contacts snapshots across user data directories that share one system dir', async (t) => {
  const sharedSystemDir = makeTempDir()
  const firstEnv = new TestEnv()
  const secondEnv = new TestEnv()
  t.after(() => {
    firstEnv.cleanup()
    secondEnv.cleanup()
    fs.rmSync(sharedSystemDir, { recursive: true, force: true })
  })

  firstEnv.seed({
    id: 'private-a',
    platform: 'weixin',
    type: 'private',
    ownerId: 'owner',
    members: [
      { id: 1, platformId: 'owner' },
      { id: 2, platformId: 'alice' },
    ],
    messages: privateMessages(5, 1, 1704103200),
  })
  secondEnv.seed({
    id: 'private-b',
    platform: 'weixin',
    type: 'private',
    ownerId: 'owner',
    members: [
      { id: 1, platformId: 'owner' },
      { id: 2, platformId: 'bob' },
    ],
    messages: privateMessages(5, 1, 1704103200),
  })

  let now = 1000
  const firstService = createContactsService({
    adapter: firstEnv.adapter,
    pathProvider: firstEnv.pathProvider({ systemDir: sharedSystemDir, userDataDir: firstEnv.dir }),
    now: () => now,
    runner: ({ signature }) => Promise.resolve(makeRuntimeSnapshot(signature, now)),
  })

  firstService.getContacts({ acceptStale: true })
  const firstFinished = await waitForTaskSettled(firstService)
  assert.equal(firstFinished.cache.status, 'fresh')
  assert.equal(firstFinished.contacts[0].key, 'weixin:alice')

  const pending = deferred<ContactsSnapshot>()
  let secondRunCalls = 0
  now = 2000
  const secondService = createContactsService({
    adapter: secondEnv.adapter,
    pathProvider: secondEnv.pathProvider({ systemDir: sharedSystemDir, userDataDir: secondEnv.dir }),
    now: () => now,
    runner: () => {
      secondRunCalls++
      return pending.promise
    },
  })

  const secondInitial = secondService.getContacts({ acceptStale: true })

  assert.equal(secondRunCalls, 1)
  assert.equal(secondInitial.cache.status, 'missing')
  assert.equal(secondInitial.contacts.length, 0)
})

test('preserves failed contact task until explicit recompute retry', async (t) => {
  const dir = makeTempDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const adapter: SessionRuntimeAdapter = {
    listSessionIds: () => [],
    openReadonly: () => null,
    openWritable: () => null,
    closeSession: () => {},
    getDbPath: () => '',
    deleteSessionFile: () => false,
    ensureReadonly: () => {
      throw new Error('not used')
    },
    ensureWritable: () => {
      throw new Error('not used')
    },
  }

  let runCalls = 0
  const service = createContactsService({
    adapter,
    systemDir: dir,
    runner: () => {
      runCalls++
      return Promise.reject(new Error('worker unavailable'))
    },
  })

  const first = service.getContacts({ acceptStale: true })
  assert.equal(first.cache.status, 'missing')
  assert.equal(first.task?.status, 'running')
  assert.equal(runCalls, 1)

  await new Promise((resolve) => setTimeout(resolve, 0))
  const failed = service.getContacts({ acceptStale: true })
  assert.equal(failed.task?.status, 'failed')
  assert.equal(failed.task?.lastError, 'worker unavailable')

  const nextGet = service.getContacts({ acceptStale: true })
  assert.equal(nextGet.task?.status, 'failed')
  assert.equal(runCalls, 1)

  const retry = service.startRecompute()
  assert.equal(retry.task?.status, 'running')
  assert.equal(runCalls, 2)
})

test('close aborts an in-flight contacts task', async (t) => {
  const dir = makeTempDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const adapter: SessionRuntimeAdapter = {
    listSessionIds: () => [],
    openReadonly: () => null,
    openWritable: () => null,
    closeSession: () => {},
    getDbPath: () => '',
    deleteSessionFile: () => false,
    ensureReadonly: () => {
      throw new Error('not used')
    },
    ensureWritable: () => {
      throw new Error('not used')
    },
  }

  let taskSignal: AbortSignal | undefined
  const service = createContactsService({
    adapter,
    systemDir: dir,
    runner: ({ signal }) => {
      taskSignal = signal
      return new Promise<ContactsSnapshot>(() => {})
    },
  })

  const first = service.getContacts({ acceptStale: true })
  assert.equal(first.task?.status, 'running')
  assert.equal(taskSignal?.aborted, false)

  await service.close()

  assert.equal(taskSignal?.aborted, true)
  assert.equal(service.getContacts({ acceptStale: true }).task?.status, 'failed')
})

test('temporary contacts worker computes and persists a fresh snapshot', async (t) => {
  const env = new TestEnv()
  t.after(() => env.cleanup())

  env.seed({
    id: 'private-a',
    platform: 'weixin',
    type: 'private',
    ownerId: 'owner',
    members: [
      { id: 1, platformId: 'owner' },
      { id: 2, platformId: 'alice' },
    ],
    messages: privateMessages(5, 1, 1704103200),
  })

  const service = createContactsService({
    adapter: env.adapter,
    pathProvider: env.pathProvider(),
    nativeBinding,
  })

  const first = service.getContacts({ acceptStale: true })
  assert.equal(first.cache.status, 'missing')
  assert.equal(first.task?.status, 'running')

  const finished = await waitForTaskSettled(service)
  assert.equal(finished.cache.status, 'fresh')
  assert.equal(finished.contacts[0].key, 'weixin:alice')
  assert.equal(finished.timeRange.preset, '1y')
  assert.equal(finished.task?.status, 'succeeded')
  assert.ok(fs.existsSync(path.join(env.dir, 'contacts', 'contacts-snapshot-1y.json')))
})
