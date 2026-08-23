import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { CHAT_DB_SCHEMA, generateSessionIndex } from '@openchatlab/core'
import type { DatabaseAdapter } from '@openchatlab/core'
import {
  ChatType,
  type ContactDetailResponse,
  type ContactItem,
  type ContactsResponse,
} from '@openchatlab/shared-types'
import { openBetterSqliteDatabase } from '../../better-sqlite3-adapter'
import type { ContactsService } from '../contacts'
import type { SessionRuntimeAdapter } from '../adapters'
import { createCrossChatAnalysisService } from './service'
import { preprocessCrossChatMessages } from './preprocess'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

interface SeedSession {
  id: string
  name: string
  type: 'private' | 'group'
  platform?: string
  ownerPlatformId?: string
  members: Array<{ id: number; platformId: string; name: string }>
  messages: Array<{ id: number; senderId: number; ts: number; content: string; replyToMessageId?: string }>
}

class TestEnvironment {
  readonly dir: string
  readonly adapter: SessionRuntimeAdapter
  private readonly dbPaths = new Map<string, string>()
  private readonly openDatabases: DatabaseAdapter[] = []

  constructor() {
    const baseDir = process.env.CHATLAB_TEST_TMPDIR ?? (fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir())
    this.dir = fs.mkdtempSync(path.join(baseDir, 'chatlab-cross-chat-analysis-'))
    const open = (sessionId: string, readonly: boolean): DatabaseAdapter | null => {
      const dbPath = this.dbPaths.get(sessionId)
      if (!dbPath) return null
      const db = openBetterSqliteDatabase(dbPath, { readonly, nativeBinding })
      this.openDatabases.push(db)
      return db
    }
    this.adapter = {
      listSessionIds: () => [...this.dbPaths.keys()],
      listSessionCandidateIds: () => [...this.dbPaths.keys()],
      openReadonly: (sessionId) => open(sessionId, true),
      openWritable: (sessionId) => open(sessionId, false),
      closeSession: () => {},
      getDbPath: (sessionId) => this.dbPaths.get(sessionId) ?? '',
      deleteSessionFile: () => false,
      ensureReadonly: (sessionId) => {
        const db = open(sessionId, true)
        if (!db) throw Object.assign(new Error(`Session not found: ${sessionId}`), { statusCode: 404 })
        return db
      },
      ensureWritable: (sessionId) => {
        const db = open(sessionId, false)
        if (!db) throw Object.assign(new Error(`Session not found: ${sessionId}`), { statusCode: 404 })
        return db
      },
    }
  }

  seed(session: SeedSession): void {
    const dbPath = path.join(this.dir, `${session.id}.db`)
    const db = openBetterSqliteDatabase(dbPath, { nativeBinding })
    db.exec(CHAT_DB_SCHEMA)
    db.prepare('INSERT INTO meta (name, platform, type, imported_at, owner_id) VALUES (?, ?, ?, ?, ?)').run(
      session.name,
      session.platform ?? 'test',
      session.type,
      1780000000,
      session.ownerPlatformId ?? null
    )
    for (const member of session.members) {
      db.prepare('INSERT INTO member (id, platform_id, account_name) VALUES (?, ?, ?)').run(
        member.id,
        member.platformId,
        member.name
      )
    }
    for (const message of session.messages) {
      db.prepare(
        `INSERT INTO message
          (id, sender_id, ts, type, content, platform_message_id, reply_to_message_id)
         VALUES (?, ?, ?, 0, ?, ?, ?)`
      ).run(
        message.id,
        message.senderId,
        message.ts,
        message.content,
        `${session.id}-${message.id}`,
        message.replyToMessageId ?? null
      )
    }
    db.close()
    this.dbPaths.set(session.id, dbPath)
  }

  cleanup(): void {
    for (const db of this.openDatabases) {
      try {
        db.close()
      } catch {
        // A test may have already closed the handle.
      }
    }
    fs.rmSync(this.dir, { recursive: true, force: true })
  }
}

function contact(
  overrides: Partial<ContactItem> & Pick<ContactItem, 'key' | 'platformId' | 'displayName'>
): ContactItem {
  return {
    key: overrides.key,
    platform: overrides.platform ?? 'test',
    platformId: overrides.platformId,
    sessionScoped: overrides.sessionScoped ?? false,
    sessionId: overrides.sessionId,
    displayName: overrides.displayName,
    aliases: overrides.aliases ?? [],
    avatar: null,
    isFriend: true,
    pool: 'friend',
    score: 1,
    scoreBreakdown: {},
    sourceSessions: overrides.sourceSessions ?? [],
    searchText: '',
    lastInteractionTs: overrides.lastInteractionTs ?? null,
  }
}

function detail(
  item: ContactItem | null,
  cacheStatus: ContactDetailResponse['cache']['status'] = 'fresh'
): ContactDetailResponse {
  return {
    contact: item,
    cache: { status: cacheStatus, computedAt: 1780000000 },
    timeRange: { preset: 'all', anchorTs: null, startTs: null },
    algorithmVersion: 'test',
  }
}

function createFixture(): {
  env: TestEnvironment
  contactsService: Pick<ContactsService, 'getContactDetail' | 'getContactsPage'>
} {
  const env = new TestEnvironment()
  env.seed({
    id: 'private-alice',
    name: 'Alice private',
    type: 'private',
    members: [
      { id: 1, platformId: 'owner', name: 'Me' },
      { id: 10, platformId: 'alice', name: 'Alice' },
    ],
    messages: [
      { id: 1, senderId: 10, ts: 100, content: 'project alpha early note' },
      { id: 2, senderId: 1, ts: 110, content: 'project alpha response' },
    ],
  })
  env.seed({
    id: 'group-work',
    name: 'Work group',
    type: 'group',
    members: [
      { id: 1, platformId: 'owner', name: 'Me' },
      { id: 20, platformId: 'alice', name: 'Alice' },
      { id: 21, platformId: 'bob', name: 'Bob' },
    ],
    messages: [
      { id: 1, senderId: 20, ts: 300, content: 'project alpha latest decision' },
      { id: 2, senderId: 21, ts: 310, content: 'project alpha unrelated sender' },
      { id: 3, senderId: 20, ts: 320, content: 'follow-up context' },
    ],
  })
  env.seed({
    id: 'group-other',
    name: 'Other group',
    type: 'group',
    members: [{ id: 30, platformId: 'alice-other', name: 'Alice' }],
    messages: [{ id: 1, senderId: 30, ts: 200, content: 'project alpha from another Alice' }],
  })

  const contactItems = [
    contact({
      key: 'test:alice',
      platformId: 'alice',
      displayName: 'Alice',
      aliases: ['Ally'],
      sourceSessions: [
        { id: 'private-alice', name: 'Alice private', platform: 'test', type: ChatType.PRIVATE },
        { id: 'group-work', name: 'Work group', platform: 'test', type: ChatType.GROUP },
      ],
    }),
    contact({
      key: 'test:bob',
      platformId: 'bob',
      displayName: 'Bob',
      sourceSessions: [{ id: 'group-work', name: 'Work group', platform: 'test', type: ChatType.GROUP }],
    }),
    contact({
      key: 'test:group-other:alice-other',
      platformId: 'alice-other',
      displayName: 'Alice',
      sessionScoped: true,
      sessionId: 'group-other',
      sourceSessions: [{ id: 'group-other', name: 'Other group', platform: 'test', type: ChatType.GROUP }],
    }),
    contact({ key: 'test:carol', platformId: 'carol', displayName: 'Carol' }),
    contact({ key: 'test:dave', platformId: 'dave', displayName: 'Dave' }),
    contact({ key: 'test:eve', platformId: 'eve', displayName: 'Eve' }),
  ]
  const contacts = new Map<string, ContactDetailResponse>([
    ['test:alice', detail(contactItems[0])],
    ['test:bob', detail(contactItems[1])],
    ['test:group-other:alice-other', detail(contactItems[2])],
    ['test:carol', detail(contactItems[3])],
    ['test:dave', detail(contactItems[4])],
    ['test:eve', detail(contactItems[5])],
  ])
  return {
    env,
    contactsService: {
      getContactDetail: (key) => contacts.get(key) ?? detail(null),
      getContactsPage: (options = {}) => {
        const query = options.query?.trim().toLocaleLowerCase() ?? ''
        const matches = contactItems.filter((item) => {
          const values = [item.displayName, ...item.aliases].map((value) => value.toLocaleLowerCase())
          return !query || values.some((value) => value.includes(query))
        })
        return {
          contacts: matches.map(({ sourceSessions: _sourceSessions, searchText: _searchText, ...item }) => item),
          cache: { status: 'fresh', computedAt: 1780000000 },
          pagination: { page: 1, pageSize: 100, total: matches.length, hasMore: false },
          task: { id: null, status: 'idle', startedAt: null, finishedAt: null, processedSessions: 0, totalSessions: 0 },
        } as ContactsResponse
      },
    },
  }
}

test('contact lookup resolves a unique alias and preserves same-name ambiguity', () => {
  const { env, contactsService } = createFixture()
  try {
    const service = createCrossChatAnalysisService({ adapter: env.adapter, contactsService })
    assert.deepEqual(service.lookupContact('Ally'), {
      query: 'Ally',
      status: 'resolved',
      cacheStatus: 'fresh',
      totalCandidates: 1,
      candidates: [
        {
          contactKey: 'test:alice',
          displayName: 'Alice',
          platform: 'test',
          aliases: ['Ally'],
          sourceSessions: [
            { id: 'private-alice', name: 'Alice private', type: ChatType.PRIVATE },
            { id: 'group-work', name: 'Work group', type: ChatType.GROUP },
          ],
        },
      ],
    })
    const ambiguous = service.lookupContact('Alice')
    assert.equal(ambiguous.status, 'ambiguous')
    assert.equal(ambiguous.totalCandidates, 2)
  } finally {
    env.cleanup()
  }
})

test('ranks private contacts by exact message totals, merges stable identities, and respects owner exclusions', async () => {
  const { env, contactsService } = createFixture()
  const day = 1_780_000_000
  env.seed({
    id: 'rank-alice-1',
    name: 'Alice private 1',
    type: 'private',
    ownerPlatformId: 'owner',
    members: [
      { id: 1, platformId: 'owner', name: 'Me' },
      { id: 2, platformId: 'alice', name: 'Alice' },
    ],
    messages: [
      { id: 1, senderId: 1, ts: day + 10, content: 'hello' },
      { id: 2, senderId: 2, ts: day + 20, content: 'hi' },
    ],
  })
  env.seed({
    id: 'rank-alice-2',
    name: 'Alice private 2',
    type: 'private',
    ownerPlatformId: 'owner',
    members: [
      { id: 1, platformId: 'owner', name: 'Me' },
      { id: 2, platformId: 'alice', name: 'Alice' },
    ],
    messages: [
      { id: 1, senderId: 2, ts: day + 30, content: 'again' },
      { id: 2, senderId: 1, ts: day + 40, content: 'reply' },
    ],
  })
  env.seed({
    id: 'rank-bob',
    name: 'Bob private',
    type: 'private',
    ownerPlatformId: 'owner',
    members: [
      { id: 1, platformId: 'owner', name: 'Me' },
      { id: 2, platformId: 'bob', name: 'Bob' },
    ],
    messages: Array.from({ length: 5 }, (_, index) => ({
      id: index + 1,
      senderId: index % 2 === 0 ? 1 : 2,
      ts: day + 86_400 + index,
      content: `bob-${index}`,
    })),
  })
  env.seed({
    id: 'rank-excluded',
    name: 'Excluded private',
    type: 'private',
    ownerPlatformId: 'owner',
    members: [
      { id: 1, platformId: 'owner', name: 'Me' },
      { id: 2, platformId: 'charlie', name: 'Charlie' },
    ],
    messages: Array.from({ length: 8 }, (_, index) => ({
      id: index + 1,
      senderId: 2,
      ts: day + index,
      content: `excluded-${index}`,
    })),
  })
  env.seed({
    id: 'rank-missing-owner',
    name: 'Missing owner private',
    type: 'private',
    members: [
      { id: 1, platformId: 'owner', name: 'Me' },
      { id: 2, platformId: 'dave', name: 'Dave' },
    ],
    messages: [{ id: 1, senderId: 2, ts: day, content: 'missing owner' }],
  })

  try {
    const service = createCrossChatAnalysisService({
      adapter: env.adapter,
      contactsService,
      getExcludedSessionIds: () => ['private-alice', 'rank-excluded'],
      now: () => 1_790_000_000_000,
    })
    const result = await service.rankPrivateContacts({ startTs: day, endTs: day + 200_000, limit: 10 })

    assert.deepEqual(
      result.items.map((item) => ({
        contactKey: item.contactKey,
        totalMessages: item.totalMessages,
        ownerMessages: item.ownerMessages,
        contactMessages: item.contactMessages,
        activeDays: item.activeDays,
        sessionIds: item.sessionIds,
      })),
      [
        {
          contactKey: 'test:bob',
          totalMessages: 5,
          ownerMessages: 3,
          contactMessages: 2,
          activeDays: 1,
          sessionIds: ['rank-bob'],
        },
        {
          contactKey: 'test:alice',
          totalMessages: 4,
          ownerMessages: 2,
          contactMessages: 2,
          activeDays: 1,
          sessionIds: ['rank-alice-1', 'rank-alice-2'],
        },
      ]
    )
    assert.equal(result.appliedRange.currentTs, 1_790_000_000)
    assert.equal(result.coverage.candidateSessions, 6)
    assert.equal(result.coverage.analyzedSessions, 3)
    assert.equal(result.coverage.excludedSessions, 2)
    assert.equal(result.coverage.missingOwnerSessions, 1)
    assert.equal(result.coverage.complete, false)
  } finally {
    env.cleanup()
  }
})

test('keeps owner activity and total group activity as separate deterministic rankings', async () => {
  const { env, contactsService } = createFixture()
  const startTs = 1_780_100_000
  env.seed({
    id: 'rank-group-owner',
    name: 'Owner group',
    type: 'group',
    ownerPlatformId: 'owner',
    members: [
      { id: 1, platformId: 'owner', name: 'Me' },
      { id: 2, platformId: 'alice', name: 'Alice' },
    ],
    messages: [
      { id: 1, senderId: 1, ts: startTs + 1, content: 'owner-1' },
      { id: 2, senderId: 1, ts: startTs + 2, content: 'owner-2' },
      { id: 3, senderId: 1, ts: startTs + 3, content: 'owner-3' },
      { id: 4, senderId: 2, ts: startTs + 4, content: 'alice' },
    ],
  })
  env.seed({
    id: 'rank-group-total',
    name: 'Busy group',
    type: 'group',
    ownerPlatformId: 'owner',
    members: [
      { id: 1, platformId: 'owner', name: 'Me' },
      { id: 2, platformId: 'bob', name: 'Bob' },
    ],
    messages: Array.from({ length: 6 }, (_, index) => ({
      id: index + 1,
      senderId: index === 0 ? 1 : 2,
      ts: startTs + 10 + index,
      content: `busy-${index}`,
    })),
  })
  env.seed({
    id: 'rank-group-missing-owner',
    name: 'Missing owner group',
    type: 'group',
    members: [{ id: 2, platformId: 'carol', name: 'Carol' }],
    messages: Array.from({ length: 7 }, (_, index) => ({
      id: index + 1,
      senderId: 2,
      ts: startTs + 20 + index,
      content: `missing-${index}`,
    })),
  })
  env.seed({
    id: 'rank-group-excluded',
    name: 'Excluded group',
    type: 'group',
    ownerPlatformId: 'owner',
    members: [
      { id: 1, platformId: 'owner', name: 'Me' },
      { id: 2, platformId: 'dave', name: 'Dave' },
    ],
    messages: Array.from({ length: 9 }, (_, index) => ({
      id: index + 1,
      senderId: 1,
      ts: startTs + 30 + index,
      content: `excluded-${index}`,
    })),
  })

  try {
    const service = createCrossChatAnalysisService({
      adapter: env.adapter,
      contactsService,
      getExcludedSessionIds: () => ['group-work', 'group-other', 'rank-group-excluded'],
      now: () => 1_790_000_000_000,
    })
    const ownerRanking = await service.rankGroupSessions({
      mode: 'owner_activity',
      startTs,
      endTs: startTs + 1_000,
    })
    const totalRanking = await service.rankGroupSessions({
      mode: 'total_activity',
      startTs,
      endTs: startTs + 1_000,
    })

    assert.deepEqual(
      ownerRanking.items.map((item) => [item.sessionId, item.ownerMessages, item.totalMessages]),
      [
        ['rank-group-owner', 3, 4],
        ['rank-group-total', 1, 6],
      ]
    )
    assert.equal(ownerRanking.items[0]?.ownerMessageShare, 0.75)
    assert.equal(ownerRanking.coverage.complete, false)
    assert.equal(ownerRanking.coverage.missingOwnerSessions, 1)

    assert.deepEqual(
      totalRanking.items.map((item) => [item.sessionId, item.ownerStatus, item.totalMessages]),
      [
        ['rank-group-missing-owner', 'missing', 7],
        ['rank-group-total', 'resolved', 6],
        ['rank-group-owner', 'resolved', 4],
      ]
    )
    assert.equal(totalRanking.coverage.candidateSessions, 6)
    assert.equal(totalRanking.coverage.analyzedSessions, 3)
    assert.equal(totalRanking.coverage.excludedSessions, 3)
    assert.equal(totalRanking.coverage.complete, true)
  } finally {
    env.cleanup()
  }
})

test('contact lookup uses the all-history snapshot for typed names and candidate details', () => {
  const { env } = createFixture()
  const pagePresets: Array<string | undefined> = []
  const detailPresets: Array<string | undefined> = []
  const legacyContact = contact({
    key: 'test:legacy',
    platformId: 'alice',
    displayName: 'Legacy Alice',
    sourceSessions: [{ id: 'private-alice', name: 'Alice private', platform: 'test', type: ChatType.PRIVATE }],
  })
  const { sourceSessions: _sourceSessions, searchText: _searchText, ...legacyListContact } = legacyContact
  const contactsService: Pick<ContactsService, 'getContactDetail' | 'getContactsPage'> = {
    getContactsPage: (options = {}) => {
      pagePresets.push(options.timeRangePreset)
      const contacts = options.timeRangePreset === 'all' ? [legacyListContact] : []
      return {
        contacts,
        diagnostics: {
          privateSessionCount: 1,
          activePrivateSessionCount: 1,
          contactsEnabled: true,
          skippedMissingOwnerSessions: 0,
          skippedUnresolvedOwnerSessions: 0,
          skippedAmbiguousPrivateSessions: 0,
          skippedInvalidPlatformIdMembers: 0,
          skippedFailedSessions: 0,
          warnings: [],
        },
        cache: { status: 'fresh', computedAt: 1780000000 },
        timeRange: { preset: 'all', anchorTs: null, startTs: null },
        algorithmVersion: 'test',
        pagination: { page: 1, pageSize: 200, total: contacts.length, hasMore: false },
        stats: { friendsTotal: contacts.length, nonFriendsTotal: 0 },
        task: { id: null, status: 'idle', startedAt: null, finishedAt: null, processedSessions: 0, totalSessions: 0 },
      }
    },
    getContactDetail: (_key, options) => {
      detailPresets.push(options?.timeRangePreset)
      return detail(options?.timeRangePreset === 'all' ? legacyContact : null)
    },
  }

  try {
    const service = createCrossChatAnalysisService({ adapter: env.adapter, contactsService })
    const result = service.lookupContact('Legacy Alice')

    assert.equal(result.status, 'resolved')
    assert.deepEqual(
      result.candidates[0]?.sourceSessions.map((session) => session.id),
      ['private-alice']
    )
    assert.deepEqual(pagePresets, ['all'])
    assert.deepEqual(detailPresets, ['all'])
  } finally {
    env.cleanup()
  }
})

test('entity resolution uses contact keys and resolves per-session member ids without merging display names', async () => {
  const { env, contactsService } = createFixture()
  try {
    const service = createCrossChatAnalysisService({ adapter: env.adapter, contactsService })
    const result = await service.resolveEntities([
      { type: 'contact', contactKey: 'test:alice', displayName: 'Alice' },
      { type: 'contact', contactKey: 'test:group-other:alice-other', displayName: 'Alice' },
    ])

    assert.deepEqual(
      result.contacts.map((item) => [
        item.ref.contactKey,
        item.sessions.map((session) => [session.sessionId, session.memberId]),
      ]),
      [
        [
          'test:alice',
          [
            ['private-alice', 10],
            ['group-work', 20],
          ],
        ],
        ['test:group-other:alice-other', [['group-other', 30]]],
      ]
    )
    assert.equal(result.coverage.resolvedEntities, 2)
    assert.equal(result.coverage.resolvedSessions, 3)
  } finally {
    env.cleanup()
  }
})

test('entity resolution uses the all-history contact snapshot so older source sessions remain searchable', async () => {
  const { env, contactsService: fixtureContactsService } = createFixture()
  try {
    const contactsService: Pick<ContactsService, 'getContactDetail' | 'getContactsPage'> = {
      ...fixtureContactsService,
      getContactDetail: (_key, options) =>
        detail(
          contact({
            key: 'test:alice',
            platformId: 'alice',
            displayName: 'Alice',
            sourceSessions:
              options?.timeRangePreset === 'all'
                ? [
                    { id: 'private-alice', name: 'Alice private', platform: 'test', type: ChatType.PRIVATE },
                    { id: 'group-work', name: 'Work group', platform: 'test', type: ChatType.GROUP },
                  ]
                : [{ id: 'group-work', name: 'Work group', platform: 'test', type: ChatType.GROUP }],
          })
        ),
    }
    const service = createCrossChatAnalysisService({ adapter: env.adapter, contactsService })

    const result = await service.resolveEntities([{ type: 'contact', contactKey: 'test:alice', displayName: 'Alice' }])

    assert.deepEqual(
      result.contacts[0]?.sessions.map((session) => session.sessionId),
      ['private-alice', 'group-work']
    )
    assert.equal(result.coverage.candidateSessions, 2)
    assert.equal(result.coverage.resolvedSessions, 2)
  } finally {
    env.cleanup()
  }
})

test('entity resolution honors interruption between contact source sessions', async () => {
  const { env, contactsService } = createFixture()
  try {
    const openedSessions: string[] = []
    const adapter: SessionRuntimeAdapter = {
      ...env.adapter,
      openReadonly: (sessionId) => {
        openedSessions.push(sessionId)
        return env.adapter.openReadonly(sessionId)
      },
    }
    const controller = new AbortController()
    const service = createCrossChatAnalysisService({ adapter, contactsService })
    const resolution = service.resolveEntities([{ type: 'contact', contactKey: 'test:alice', displayName: 'Alice' }], {
      signal: controller.signal,
    })

    queueMicrotask(() => controller.abort())

    await assert.rejects(resolution, { name: 'AbortError' })
    assert.ok(openedSessions.length > 0)
    assert.ok(openedSessions.length < 2)
  } finally {
    env.cleanup()
  }
})

test('contact session inspection scans imported sessions and separates own messages from roster-only presence', async () => {
  const { env, contactsService } = createFixture()
  try {
    env.seed({
      id: 'group-roster',
      name: 'Roster group',
      type: 'group',
      members: [
        { id: 40, platformId: 'alice', name: 'Alice' },
        { id: 41, platformId: 'bob', name: 'Bob' },
      ],
      messages: [{ id: 1, senderId: 41, ts: 400, content: 'Only Bob spoke' }],
    })
    const service = createCrossChatAnalysisService({ adapter: env.adapter, contactsService })
    const result = await service.inspectContactSessions({ contactKey: 'test:alice' })

    assert.equal(result.contact?.contactKey, 'test:alice')
    assert.deepEqual(
      result.sessions.map((session) => [
        session.sessionId,
        session.ownMessageCount,
        session.sessionMessageCount,
        session.presence,
        session.lastOwnMessageTs,
      ]),
      [
        ['group-roster', 0, 1, 'roster_only', null],
        ['group-work', 2, 3, 'spoke', 320],
        ['private-alice', 1, 2, 'spoke', 100],
      ]
    )
    assert.deepEqual(result.summary, {
      scope: 'complete_result',
      matchedSessions: 3,
      privateSessions: 1,
      groupSessions: 2,
      spokeSessions: 2,
      rosterOnlySessions: 1,
      ownMessageCount: 3,
      firstOwnMessageTs: 100,
      lastOwnMessageTs: 320,
    })
    assert.equal(result.coverage.candidateSessions, 4)
    assert.equal(result.coverage.scannedSessions, 4)
    assert.equal(result.coverage.complete, true)
  } finally {
    env.cleanup()
  }
})

test('contact session inspection uses the all-history contact snapshot', async () => {
  const { env, contactsService: fixtureContactsService } = createFixture()
  const detailPresets: Array<string | undefined> = []
  try {
    const contactsService: Pick<ContactsService, 'getContactDetail' | 'getContactsPage'> = {
      ...fixtureContactsService,
      getContactDetail: (key, options) => {
        detailPresets.push(options?.timeRangePreset)
        return options?.timeRangePreset === 'all' ? fixtureContactsService.getContactDetail(key, options) : detail(null)
      },
    }
    const service = createCrossChatAnalysisService({ adapter: env.adapter, contactsService })

    const result = await service.inspectContactSessions({ contactKey: 'test:alice' })

    assert.equal(result.contact?.contactKey, 'test:alice')
    assert.deepEqual(
      result.sessions.map((session) => session.sessionId),
      ['group-work', 'private-alice']
    )
    assert.deepEqual(detailPresets, ['all'])
  } finally {
    env.cleanup()
  }
})

test('contact session inspection validates raw candidates inside failure, time, and cancellation boundaries', async () => {
  const { env, contactsService } = createFixture()
  try {
    const candidateIds = [...env.adapter.listSessionCandidateIds!(), 'damaged']
    let eagerEnumerationCalled = false
    const failureAdapter: SessionRuntimeAdapter = {
      ...env.adapter,
      listSessionIds: () => {
        eagerEnumerationCalled = true
        throw new Error('eager enumeration should not be used')
      },
      listSessionCandidateIds: () => candidateIds,
      openReadonly: (sessionId) => {
        if (sessionId === 'damaged') throw new Error('fixture failure')
        return env.adapter.openReadonly(sessionId)
      },
    }
    const failureResult = await createCrossChatAnalysisService({
      adapter: failureAdapter,
      contactsService,
    }).inspectContactSessions({ contactKey: 'test:alice' })

    assert.equal(eagerEnumerationCalled, false)
    assert.deepEqual(
      failureResult.sessions.map((session) => session.sessionId),
      ['group-work', 'private-alice']
    )
    assert.deepEqual(failureResult.coverage.failedSessionIds, ['damaged'])

    let now = 0
    const openedSessions: string[] = []
    const timedAdapter: SessionRuntimeAdapter = {
      ...env.adapter,
      openReadonly: (sessionId) => {
        openedSessions.push(sessionId)
        const db = env.adapter.openReadonly(sessionId)
        now += 9_000
        return db
      },
    }
    const timedResult = await createCrossChatAnalysisService({
      adapter: timedAdapter,
      contactsService,
      now: () => now,
    }).inspectContactSessions({ contactKey: 'test:alice', maxWallTimeMs: 8_000 })

    assert.equal(openedSessions.length, 1)
    assert.equal(timedResult.coverage.scannedSessions, 1)
    assert.ok(timedResult.coverage.truncatedReasons.includes('time_budget'))
    assert.ok(timedResult.coverage.nextCursor)

    const controller = new AbortController()
    const service = createCrossChatAnalysisService({ adapter: env.adapter, contactsService })
    await assert.rejects(
      () =>
        service.inspectContactSessions(
          { contactKey: 'test:alice' },
          {
            signal: controller.signal,
            onProgress: (progress) => {
              if (progress.currentSessionId === 'group-work') controller.abort()
            },
          }
        ),
      { name: 'AbortError' }
    )
  } finally {
    env.cleanup()
  }
})

test('contact session inspection does not merge the same platform id across platforms', async () => {
  const { env, contactsService } = createFixture()
  try {
    env.seed({
      id: 'foreign-alice',
      name: 'Foreign Alice',
      type: 'group',
      platform: 'other',
      members: [{ id: 50, platformId: 'alice', name: 'Alice' }],
      messages: [{ id: 1, senderId: 50, ts: 450, content: 'Foreign platform message' }],
    })
    const foreignContact = contact({
      key: 'other:alice',
      platform: 'other',
      platformId: 'alice',
      displayName: 'Alice',
    })
    const service = createCrossChatAnalysisService({
      adapter: env.adapter,
      contactsService: {
        ...contactsService,
        getContactDetail: (key, options) =>
          key === foreignContact.key ? detail(foreignContact) : contactsService.getContactDetail(key, options),
      },
    })

    const result = await service.inspectContactSessions({ contactKey: foreignContact.key })

    assert.deepEqual(
      result.sessions.map((session) => session.sessionId),
      ['foreign-alice']
    )
  } finally {
    env.cleanup()
  }
})

test('contact session inspection honors time ranges, session-scoped identity, and continuation cursors', async () => {
  const { env, contactsService } = createFixture()
  try {
    const service = createCrossChatAnalysisService({ adapter: env.adapter, contactsService })
    const scoped = await service.inspectContactSessions({
      contactKey: 'test:group-other:alice-other',
      startTs: 250,
    })
    assert.deepEqual(
      scoped.sessions.map((session) => [session.sessionId, session.presence]),
      [['group-other', 'roster_only']]
    )

    const first = await service.inspectContactSessions({ contactKey: 'test:alice', pageSize: 1 })
    assert.deepEqual(
      first.sessions.map((session) => session.sessionId),
      ['group-work']
    )
    assert.equal(first.coverage.complete, false)
    assert.ok(first.coverage.nextCursor)
    assert.ok(first.coverage.truncatedReasons.includes('page_size'))

    const second = await service.inspectContactSessions({
      contactKey: 'test:alice',
      pageSize: 1,
      cursor: first.coverage.nextCursor ?? undefined,
    })
    assert.deepEqual(
      second.sessions.map((session) => session.sessionId),
      ['private-alice']
    )
    assert.equal(second.summary.scope, 'current_batch')
    assert.equal(second.coverage.complete, true)
  } finally {
    env.cleanup()
  }
})

test('structural inspections resolve recent-day windows from the service clock', async () => {
  const { env, contactsService } = createFixture()
  try {
    const service = createCrossChatAnalysisService({
      adapter: env.adapter,
      contactsService,
      now: () => 86_500_000,
    })
    const contactResult = await service.inspectContactSessions({
      contactKey: 'test:alice',
      recentDays: 1,
    })
    const sharedResult = await service.inspectSharedInteractions({
      participants: [
        { type: 'contact', contactKey: 'test:alice' },
        { type: 'contact', contactKey: 'test:bob' },
      ],
      recentDays: 1,
    })

    assert.deepEqual(contactResult.appliedRange, {
      startTs: 100,
      endTs: 86_500,
      dataEarliestMessageTs: 100,
      dataLatestMessageTs: 320,
    })
    assert.deepEqual(sharedResult.appliedRange, {
      startTs: 100,
      endTs: 86_500,
      dataEarliestMessageTs: 300,
      dataLatestMessageTs: 320,
    })
  } finally {
    env.cleanup()
  }
})

test('contact session inspection isolates failures and stops at abort or wall-time boundaries', async () => {
  const { env, contactsService } = createFixture()
  try {
    const failingAdapter: SessionRuntimeAdapter = {
      ...env.adapter,
      openReadonly: (sessionId) => {
        if (sessionId === 'group-work') throw new Error('fixture failure')
        return env.adapter.openReadonly(sessionId)
      },
    }
    const failureResult = await createCrossChatAnalysisService({
      adapter: failingAdapter,
      contactsService,
    }).inspectContactSessions({ contactKey: 'test:alice' })
    assert.deepEqual(
      failureResult.sessions.map((session) => session.sessionId),
      ['private-alice']
    )
    assert.deepEqual(failureResult.coverage.failedSessionIds, ['group-work'])

    const controller = new AbortController()
    const service = createCrossChatAnalysisService({ adapter: env.adapter, contactsService })
    await assert.rejects(
      () =>
        service.inspectContactSessions(
          { contactKey: 'test:alice' },
          {
            signal: controller.signal,
            onProgress: (progress) => {
              if (progress.currentSessionId === 'group-work') controller.abort()
            },
          }
        ),
      { name: 'AbortError' }
    )

    const timestamps = [0, 0, 9_000]
    const wallTimeResult = await createCrossChatAnalysisService({
      adapter: env.adapter,
      contactsService,
      now: () => timestamps.shift() ?? 9_000,
    }).inspectContactSessions({
      contactKey: 'test:alice',
      maxWallTimeMs: 8_000,
    })
    assert.equal(wallTimeResult.coverage.scannedSessions, 1)
    assert.ok(wallTimeResult.coverage.truncatedReasons.includes('time_budget'))
    assert.ok(wallTimeResult.coverage.nextCursor)
  } finally {
    env.cleanup()
  }
})

test('shared interaction inspection finds two non-owner contacts and preserves reply direction and anchors', async () => {
  const { env, contactsService } = createFixture()
  try {
    env.seed({
      id: 'group-social',
      name: 'Social group',
      type: 'group',
      ownerPlatformId: 'owner',
      members: [
        { id: 1, platformId: 'owner', name: 'Me' },
        { id: 10, platformId: 'alice', name: 'Alice' },
        { id: 20, platformId: 'bob', name: 'Bob' },
      ],
      messages: [
        { id: 1, senderId: 10, ts: 500, content: 'Alice starts' },
        {
          id: 2,
          senderId: 20,
          ts: 510,
          content: 'Bob replies',
          replyToMessageId: 'group-social-1',
        },
        { id: 3, senderId: 1, ts: 520, content: 'Owner joins' },
      ],
    })
    const service = createCrossChatAnalysisService({ adapter: env.adapter, contactsService })
    const result = await service.inspectSharedInteractions({
      participants: [
        { type: 'contact', contactKey: 'test:alice' },
        { type: 'contact', contactKey: 'test:bob' },
      ],
    })

    assert.deepEqual(
      result.sessions.map((session) => session.sessionId),
      ['group-social', 'group-work']
    )
    const social = result.sessions[0]
    assert.deepEqual(
      social.participants.map((participant) => [participant.participantIndex, participant.messageCount]),
      [
        [0, 1],
        [1, 1],
      ]
    )
    assert.equal(social.pairs[0].directReplyCount, 1)
    assert.equal(social.pairs[0].repliesFromSourceToTarget, 0)
    assert.equal(social.pairs[0].repliesFromTargetToSource, 1)
    assert.deepEqual(social.pairs[0].anchors[0], {
      sessionId: 'group-social',
      messageId: 2,
      relatedMessageId: 1,
      timestamp: 510,
      signal: 'direct_reply',
      fromParticipantIndex: 1,
      toParticipantIndex: 0,
    })
    assert.equal(result.summary.commonSessions, 2)
    assert.equal(result.summary.sessionsWithDirectReplies, 1)
    assert.deepEqual(result.coverage.unresolvedParticipantIndexes, [])
    assert.equal(result.coverage.complete, true)
  } finally {
    env.cleanup()
  }
})

test('shared interaction inspection validates raw candidates within failure and budget boundaries', async () => {
  const { env, contactsService } = createFixture()
  const participants = [
    { type: 'contact' as const, contactKey: 'test:alice' },
    { type: 'contact' as const, contactKey: 'test:bob' },
  ]
  try {
    const candidateIds = [...env.adapter.listSessionCandidateIds!(), 'damaged']
    let eagerEnumerationCalled = false
    const failureAdapter: SessionRuntimeAdapter = {
      ...env.adapter,
      listSessionIds: () => {
        eagerEnumerationCalled = true
        throw new Error('eager enumeration should not be used')
      },
      listSessionCandidateIds: () => candidateIds,
      openReadonly: (sessionId) => {
        if (sessionId === 'damaged') throw new Error('fixture failure')
        return env.adapter.openReadonly(sessionId)
      },
    }
    const failureResult = await createCrossChatAnalysisService({
      adapter: failureAdapter,
      contactsService,
    }).inspectSharedInteractions({ participants })

    assert.equal(eagerEnumerationCalled, false)
    assert.deepEqual(
      failureResult.sessions.map((session) => session.sessionId),
      ['group-work']
    )
    assert.deepEqual(failureResult.coverage.failedSessionIds, ['damaged'])

    let identityNow = 0
    const identityOpenedSessions: string[] = []
    const slowContactsService: Pick<ContactsService, 'getContactDetail' | 'getContactsPage'> = {
      ...contactsService,
      getContactDetail: (key, options) => {
        const result = contactsService.getContactDetail(key, options)
        identityNow = 9_000
        return result
      },
    }
    const identityTimedAdapter: SessionRuntimeAdapter = {
      ...env.adapter,
      openReadonly: (sessionId) => {
        identityOpenedSessions.push(sessionId)
        return env.adapter.openReadonly(sessionId)
      },
    }
    const identityTimedResult = await createCrossChatAnalysisService({
      adapter: identityTimedAdapter,
      contactsService: slowContactsService,
      now: () => identityNow,
    }).inspectSharedInteractions({ participants, maxWallTimeMs: 8_000 })

    assert.deepEqual(identityOpenedSessions, [])
    assert.equal(identityTimedResult.coverage.scannedSessions, 0)
    assert.ok(identityTimedResult.coverage.truncatedReasons.includes('time_budget'))

    let now = 0
    const openedSessions: string[] = []
    const timedAdapter: SessionRuntimeAdapter = {
      ...env.adapter,
      listSessionCandidateIds: () => {
        now = 9_000
        return env.adapter.listSessionCandidateIds!()
      },
      openReadonly: (sessionId) => {
        openedSessions.push(sessionId)
        return env.adapter.openReadonly(sessionId)
      },
    }
    const timedResult = await createCrossChatAnalysisService({
      adapter: timedAdapter,
      contactsService,
      now: () => now,
    }).inspectSharedInteractions({ participants, maxWallTimeMs: 8_000 })

    assert.deepEqual(openedSessions, [])
    assert.equal(timedResult.coverage.scannedSessions, 0)
    assert.ok(timedResult.coverage.truncatedReasons.includes('time_budget'))
    assert.ok(timedResult.coverage.nextCursor)

    const controller = new AbortController()
    const cancelledAdapter: SessionRuntimeAdapter = {
      ...env.adapter,
      listSessionCandidateIds: () => {
        controller.abort()
        return env.adapter.listSessionCandidateIds!()
      },
    }
    await assert.rejects(
      () =>
        createCrossChatAnalysisService({ adapter: cancelledAdapter, contactsService }).inspectSharedInteractions(
          { participants },
          { signal: controller.signal }
        ),
      { name: 'AbortError' }
    )
  } finally {
    env.cleanup()
  }
})

test('shared interaction inspection excludes cross-window messages from proximity signals', async () => {
  const { env, contactsService } = createFixture()
  try {
    env.seed({
      id: 'group-distant',
      name: 'Distant group',
      type: 'group',
      members: [
        { id: 10, platformId: 'alice', name: 'Alice' },
        { id: 20, platformId: 'bob', name: 'Bob' },
      ],
      messages: [
        { id: 1, senderId: 10, ts: 500, content: 'Alice' },
        { id: 2, senderId: 20, ts: 500 + 2 * 86400, content: 'Bob much later' },
      ],
    })
    const result = await createCrossChatAnalysisService({
      adapter: env.adapter,
      contactsService,
    }).inspectSharedInteractions({
      participants: [
        { type: 'contact', contactKey: 'test:alice' },
        { type: 'contact', contactKey: 'test:bob' },
      ],
    })

    const distant = result.sessions.find((session) => session.sessionId === 'group-distant')
    assert.ok(distant)
    assert.equal(distant.pairs[0].coOccurrenceCount, 0)
    assert.equal(distant.pairs[0].coOccurrenceRawScore, 0)
    assert.equal(distant.pairs[0].lastProximityTs, null)
    assert.equal(
      distant.pairs[0].anchors.some((anchor) => anchor.signal === 'proximity'),
      false
    )
    assert.equal(distant.priorityReasons.includes('has_proximity'), false)
    assert.equal(result.summary.sessionsWithProximitySignals, 1)
  } finally {
    env.cleanup()
  }
})

test('shared interaction inspection resolves participants from the all-history contact snapshot', async () => {
  const { env, contactsService: fixtureContactsService } = createFixture()
  const detailPresets: Array<string | undefined> = []
  try {
    const contactsService: Pick<ContactsService, 'getContactDetail' | 'getContactsPage'> = {
      ...fixtureContactsService,
      getContactDetail: (key, options) => {
        detailPresets.push(options?.timeRangePreset)
        return options?.timeRangePreset === 'all' ? fixtureContactsService.getContactDetail(key, options) : detail(null)
      },
    }
    const service = createCrossChatAnalysisService({ adapter: env.adapter, contactsService })

    const result = await service.inspectSharedInteractions({
      participants: [
        { type: 'contact', contactKey: 'test:alice' },
        { type: 'contact', contactKey: 'test:bob' },
      ],
    })

    assert.deepEqual(
      result.sessions.map((session) => session.sessionId),
      ['group-work']
    )
    assert.deepEqual(detailPresets, ['all', 'all'])
  } finally {
    env.cleanup()
  }
})

test('shared interaction inspection resumes common sessions without skipping a page', async () => {
  const { env, contactsService } = createFixture()
  try {
    env.seed({
      id: 'group-social',
      name: 'Social group',
      type: 'group',
      members: [
        { id: 10, platformId: 'alice', name: 'Alice' },
        { id: 20, platformId: 'bob', name: 'Bob' },
      ],
      messages: [
        { id: 1, senderId: 10, ts: 500, content: 'Alice' },
        { id: 2, senderId: 20, ts: 510, content: 'Bob' },
      ],
    })
    const service = createCrossChatAnalysisService({ adapter: env.adapter, contactsService })
    const participants = [
      { type: 'contact' as const, contactKey: 'test:alice' },
      { type: 'contact' as const, contactKey: 'test:bob' },
    ]
    const first = await service.inspectSharedInteractions({ participants, pageSize: 1 })
    assert.deepEqual(
      first.sessions.map((session) => session.sessionId),
      ['group-social']
    )
    assert.ok(first.coverage.nextCursor)
    assert.ok(first.coverage.truncatedReasons.includes('page_size'))

    const second = await service.inspectSharedInteractions({
      participants,
      pageSize: 1,
      cursor: first.coverage.nextCursor ?? undefined,
    })
    assert.deepEqual(
      second.sessions.map((session) => session.sessionId),
      ['group-work']
    )
    assert.ok(second.coverage.nextCursor)

    const final = await service.inspectSharedInteractions({
      participants,
      pageSize: 1,
      cursor: second.coverage.nextCursor ?? undefined,
    })
    assert.deepEqual(final.sessions, [])
    assert.equal(final.coverage.complete, true)
  } finally {
    env.cleanup()
  }
})

test('shared interaction inspection resolves owner per session without blocking non-owner pairs', async () => {
  const { env, contactsService } = createFixture()
  try {
    env.seed({
      id: 'owner-alice',
      name: 'Owner and Alice',
      type: 'private',
      ownerPlatformId: 'owner',
      members: [
        { id: 1, platformId: 'owner', name: 'Me' },
        { id: 2, platformId: 'alice', name: 'Alice' },
      ],
      messages: [
        { id: 1, senderId: 1, ts: 600, content: 'Owner' },
        { id: 2, senderId: 2, ts: 610, content: 'Alice' },
      ],
    })
    const service = createCrossChatAnalysisService({ adapter: env.adapter, contactsService })
    const result = await service.inspectSharedInteractions({
      participants: [{ type: 'owner' }, { type: 'contact', contactKey: 'test:alice' }],
    })

    assert.deepEqual(
      result.sessions.map((session) => session.sessionId),
      ['owner-alice']
    )
    assert.ok(result.coverage.ownerResolution)
    assert.equal(result.coverage.ownerResolution.resolvedSessions, 1)
    assert.ok(result.coverage.ownerResolution.missingOwnerSessions > 0)
  } finally {
    env.cleanup()
  }
})

test('shared interaction inspection uses the exact all-participant intersection for three people', async () => {
  const { env, contactsService } = createFixture()
  try {
    env.seed({
      id: 'group-pair-only',
      name: 'Pair only',
      type: 'group',
      members: [
        { id: 1, platformId: 'alice', name: 'Alice' },
        { id: 2, platformId: 'bob', name: 'Bob' },
      ],
      messages: [
        { id: 1, senderId: 1, ts: 700, content: 'Alice' },
        { id: 2, senderId: 2, ts: 710, content: 'Bob' },
      ],
    })
    env.seed({
      id: 'group-trio',
      name: 'Trio',
      type: 'group',
      members: [
        { id: 10, platformId: 'alice', name: 'Alice' },
        { id: 20, platformId: 'bob', name: 'Bob' },
        { id: 30, platformId: 'carol', name: 'Carol' },
      ],
      messages: [
        { id: 1, senderId: 10, ts: 800, content: 'Alice' },
        { id: 2, senderId: 20, ts: 810, content: 'Bob' },
        { id: 3, senderId: 30, ts: 820, content: 'Carol' },
      ],
    })
    const service = createCrossChatAnalysisService({ adapter: env.adapter, contactsService })
    const result = await service.inspectSharedInteractions({
      participants: [
        { type: 'contact', contactKey: 'test:alice' },
        { type: 'contact', contactKey: 'test:bob' },
        { type: 'contact', contactKey: 'test:carol' },
      ],
    })

    assert.deepEqual(
      result.sessions.map((session) => session.sessionId),
      ['group-trio']
    )
    assert.equal(result.sessions[0].participants.length, 3)
    assert.equal(result.sessions[0].pairs.length, 3)
    assert.equal(result.sessions[0].allParticipantsCoActiveDays, 1)
    assert.deepEqual(
      result.sessions[0].pairs.map((pair) => [pair.sourceParticipantIndex, pair.targetParticipantIndex]),
      [
        [0, 1],
        [0, 2],
        [1, 2],
      ]
    )
  } finally {
    env.cleanup()
  }
})

test('shared interaction inspection supports five people without materializing unrelated group edges', async () => {
  const { env, contactsService } = createFixture()
  try {
    env.seed({
      id: 'group-five',
      name: 'Five people',
      type: 'group',
      members: [
        { id: 10, platformId: 'alice', name: 'Alice' },
        { id: 20, platformId: 'bob', name: 'Bob' },
        { id: 30, platformId: 'carol', name: 'Carol' },
        { id: 40, platformId: 'dave', name: 'Dave' },
        { id: 50, platformId: 'eve', name: 'Eve' },
        { id: 60, platformId: 'other', name: 'Other' },
      ],
      messages: [
        { id: 1, senderId: 10, ts: 900, content: 'Alice' },
        { id: 2, senderId: 20, ts: 901, content: 'Bob' },
        { id: 3, senderId: 30, ts: 902, content: 'Carol' },
        { id: 4, senderId: 40, ts: 903, content: 'Dave' },
        { id: 5, senderId: 50, ts: 904, content: 'Eve' },
        { id: 6, senderId: 60, ts: 905, content: 'Other' },
      ],
    })
    const service = createCrossChatAnalysisService({ adapter: env.adapter, contactsService })
    const participants = ['alice', 'bob', 'carol', 'dave', 'eve'].map((name) => ({
      type: 'contact' as const,
      contactKey: `test:${name}`,
    }))
    const result = await service.inspectSharedInteractions({ participants })

    assert.deepEqual(
      result.sessions.map((session) => session.sessionId),
      ['group-five']
    )
    assert.equal(result.sessions[0].pairs.length, 10)
    await assert.rejects(
      () =>
        service.inspectSharedInteractions({
          participants: [...participants, { type: 'contact', contactKey: 'test:sixth' }],
        }),
      /2 to 5 distinct people/
    )
  } finally {
    env.cleanup()
  }
})

test('scoped search filters by resolved member ids and keeps compound evidence identity', async () => {
  const { env, contactsService } = createFixture()
  try {
    const service = createCrossChatAnalysisService({ adapter: env.adapter, contactsService })
    const result = await service.searchMessages({
      keywords: ['project alpha'],
      scopes: [
        { sessionId: 'private-alice', memberIds: [10] },
        { sessionId: 'group-work', memberIds: [20] },
      ],
      maxEvidence: 10,
    })

    assert.deepEqual(
      result.messages.map((message) => [message.sessionId, message.messageId, message.senderId, message.evidenceRole]),
      [
        ['group-work', 3, 20, 'context'],
        ['group-work', 2, 21, 'context'],
        ['group-work', 1, 20, 'match'],
        ['private-alice', 2, 1, 'context'],
        ['private-alice', 1, 10, 'match'],
      ]
    )
    assert.equal(result.coverage.truncated, false)

    const context = service.getMessageContext({ sessionId: 'group-work', messageId: 1, contextSize: 1 })
    assert.deepEqual(
      context.messages.map((message) => [message.sessionId, message.messageId]),
      [
        ['group-work', 1],
        ['group-work', 2],
      ]
    )
  } finally {
    env.cleanup()
  }
})

test('message context stays inside the indexed segment around the matched message', () => {
  const { env, contactsService } = createFixture()
  try {
    env.seed({
      id: 'segmented-chat',
      name: 'Segmented chat',
      type: 'group',
      members: [
        { id: 1, platformId: 'owner', name: 'Me' },
        { id: 2, platformId: 'other', name: 'Other' },
      ],
      messages: [
        { id: 1, senderId: 1, ts: 100, content: 'first segment start' },
        { id: 2, senderId: 2, ts: 110, content: 'first segment end' },
        { id: 3, senderId: 1, ts: 1_000, content: 'matched second segment start' },
        { id: 4, senderId: 2, ts: 1_010, content: 'second segment continuation' },
      ],
    })
    const db = env.adapter.ensureWritable('segmented-chat')
    generateSessionIndex(db, 100)
    db.close()
    const service = createCrossChatAnalysisService({ adapter: env.adapter, contactsService })

    const context = service.getMessageContext({ sessionId: 'segmented-chat', messageId: 3, contextSize: 1 })

    assert.deepEqual(
      context.messages.map((message) => message.messageId),
      [3, 4]
    )
  } finally {
    env.cleanup()
  }
})

test('recent session recap returns a bounded latest slice plus existing summaries', () => {
  const { env, contactsService } = createFixture()
  try {
    env.seed({
      id: 'recent-recap',
      name: 'Recent recap',
      type: 'private',
      members: [
        { id: 1, platformId: 'owner', name: 'Me' },
        { id: 2, platformId: 'friend', name: 'Friend' },
      ],
      messages: Array.from({ length: 220 }, (_, index) => ({
        id: index + 1,
        senderId: index % 2 === 0 ? 1 : 2,
        ts: 1_000 + index * 100,
        content: `message-${index + 1}`,
      })),
    })
    const db = env.adapter.ensureWritable('recent-recap')
    generateSessionIndex(db, 10)
    db.exec("UPDATE segment SET summary = 'summary-' || id, summary_message_count = message_count")
    db.close()
    const service = createCrossChatAnalysisService({ adapter: env.adapter, contactsService })

    const result = service.readRecentSession('recent-recap')

    assert.deepEqual(
      result.messages.map((message) => message.messageId),
      Array.from({ length: 200 }, (_, index) => 220 - index)
    )
    assert.deepEqual(
      result.summaries.map((summary) => summary.summary),
      ['summary-220', 'summary-219', 'summary-218', 'summary-217', 'summary-216']
    )
    assert.deepEqual(result.coverage, {
      totalMessages: 220,
      returnedMessages: 200,
      returnedSummaries: 5,
      hasEarlierMessages: true,
    })
  } finally {
    env.cleanup()
  }
})

test('scoped search spends its internal evidence budget on private-chat context before groups', async () => {
  const { env, contactsService } = createFixture()
  try {
    const service = createCrossChatAnalysisService({ adapter: env.adapter, contactsService })
    const result = await service.searchMessages({
      keywords: ['project alpha'],
      scopes: [
        { sessionId: 'group-work', memberIds: [20] },
        { sessionId: 'private-alice', memberIds: [10] },
      ],
      maxEvidence: 2,
    })

    assert.deepEqual(
      result.messages.map((message) => [message.sessionId, message.messageId, message.evidenceRole]),
      [
        ['private-alice', 2, 'context'],
        ['private-alice', 1, 'match'],
      ]
    )
    assert.ok(result.coverage.truncatedReasons.includes('evidence_budget'))
  } finally {
    env.cleanup()
  }
})

test('scoped group search spends remaining evidence on the most active matching group', async () => {
  const { env, contactsService } = createFixture()
  try {
    const service = createCrossChatAnalysisService({ adapter: env.adapter, contactsService })
    const result = await service.searchMessages({
      keywords: [],
      scopes: [
        { sessionId: 'group-other', memberIds: [30] },
        { sessionId: 'group-work', memberIds: [20] },
      ],
      maxEvidence: 2,
    })

    assert.deepEqual([...new Set(result.messages.map((message) => message.sessionId))], ['group-work'])
  } finally {
    env.cleanup()
  }
})

test('search defaults to at most one thousand context-inclusive evidence messages', async () => {
  const { env, contactsService } = createFixture()
  try {
    env.seed({
      id: 'large-private',
      name: 'Large private',
      type: 'private',
      members: [
        { id: 1, platformId: 'owner', name: 'Me' },
        { id: 2, platformId: 'target', name: 'Target' },
      ],
      messages: Array.from({ length: 1_100 }, (_, index) => ({
        id: index + 1,
        senderId: 2,
        ts: index + 1,
        content: `activity ${index + 1}`,
      })),
    })
    const service = createCrossChatAnalysisService({ adapter: env.adapter, contactsService })
    const result = await service.searchMessages({
      keywords: [],
      scopes: [{ sessionId: 'large-private', memberIds: [2] }],
    })

    assert.equal(result.totalMatches, 1_100)
    assert.equal(result.messages.length, 1_000)
    assert.ok(result.coverage.truncatedReasons.includes('evidence_budget'))
  } finally {
    env.cleanup()
  }
})

test('global search scans recent sessions first and reports budget truncation', async () => {
  const { env, contactsService } = createFixture()
  try {
    const service = createCrossChatAnalysisService({ adapter: env.adapter, contactsService })
    const progress: string[] = []
    const result = await service.searchMessages(
      { keywords: ['project alpha'], maxSessions: 1, maxEvidence: 10 },
      { onProgress: (item) => item.currentSessionId && progress.push(item.currentSessionId) }
    )

    assert.deepEqual(progress, ['group-work'])
    assert.deepEqual(
      result.messages.map((message) => message.sessionId),
      ['group-work', 'group-work', 'group-work']
    )
    assert.equal(result.coverage.candidateSessions, 3)
    assert.equal(result.coverage.scannedSessions, 1)
    assert.equal(result.coverage.truncated, true)
    assert.ok(result.coverage.truncatedReasons.includes('session_budget'))
  } finally {
    env.cleanup()
  }
})

test('global search applies the relative time range and resolves the owner independently in each session', async () => {
  const { env, contactsService } = createFixture()
  const nowSeconds = 10_000_000
  try {
    env.seed({
      id: 'recent-owner-session',
      name: 'Recent owner session',
      type: 'group',
      ownerPlatformId: 'owner-local',
      members: [
        { id: 40, platformId: 'owner-local', name: 'Me' },
        { id: 41, platformId: 'other', name: 'Other' },
      ],
      messages: [
        { id: 1, senderId: 40, ts: nowSeconds - 100, content: 'buying a home' },
        { id: 2, senderId: 41, ts: nowSeconds - 90, content: 'buying a home too' },
        { id: 3, senderId: 40, ts: nowSeconds - 91 * 86400, content: 'old buying a home note' },
      ],
    })
    env.seed({
      id: 'missing-owner-session',
      name: 'Missing owner session',
      type: 'private',
      members: [{ id: 50, platformId: 'someone', name: 'Someone' }],
      messages: [{ id: 1, senderId: 50, ts: nowSeconds - 80, content: 'buying a home' }],
    })
    const service = createCrossChatAnalysisService({
      adapter: env.adapter,
      contactsService,
      now: () => nowSeconds * 1000,
    })
    const result = await service.searchMessages({
      keywords: ['buying a home'],
      recentDays: 90,
      sender: 'owner',
      maxSessions: 10,
      maxEvidence: 10,
    })

    assert.deepEqual(
      result.messages.map((message) => [message.sessionId, message.messageId, message.senderId]),
      [
        ['recent-owner-session', 2, 41],
        ['recent-owner-session', 1, 40],
      ]
    )
    assert.deepEqual(result.appliedFilters, {
      startTs: nowSeconds - 90 * 86400,
      endTs: nowSeconds,
      recentDays: 90,
      sender: 'owner',
    })
    assert.deepEqual(result.coverage.ownerResolution, {
      resolvedSessions: 1,
      missingOwnerSessions: 4,
      unresolvedOwnerSessions: 0,
    })
  } finally {
    env.cleanup()
  }
})

test('search allows empty keywords for scoped sampling but rejects unscoped scans', async () => {
  const { env, contactsService } = createFixture()
  try {
    const service = createCrossChatAnalysisService({ adapter: env.adapter, contactsService })
    await assert.rejects(() => service.searchMessages({ keywords: [] }), /keyword/i)
    const scoped = await service.searchMessages({
      keywords: [],
      scopes: [{ sessionId: 'group-work', memberIds: [20] }],
      maxEvidence: 10,
    })
    assert.deepEqual(
      scoped.messages.map((message) => [message.sessionId, message.messageId, message.senderId]),
      [
        ['group-work', 3, 20],
        ['group-work', 2, 21],
        ['group-work', 1, 20],
      ]
    )

    const controller = new AbortController()
    controller.abort()
    await assert.rejects(() => service.searchMessages({ keywords: ['project'] }, { signal: controller.signal }), {
      name: 'AbortError',
    })
  } finally {
    env.cleanup()
  }
})

test('search honors interruption between session scans', async () => {
  const { env, contactsService } = createFixture()
  try {
    const service = createCrossChatAnalysisService({ adapter: env.adapter, contactsService })
    const controller = new AbortController()
    await assert.rejects(
      () =>
        service.searchMessages(
          { keywords: ['project'], maxSessions: 3 },
          {
            signal: controller.signal,
            onProgress: (progress) => {
              if (progress.currentSessionId === 'group-other') controller.abort()
            },
          }
        ),
      { name: 'AbortError' }
    )
  } finally {
    env.cleanup()
  }
})

test('search stops during candidate preparation when the wall-time budget is exhausted', async () => {
  const { env, contactsService } = createFixture()
  try {
    let now = 0
    const openedSessions: string[] = []
    const adapter: SessionRuntimeAdapter = {
      ...env.adapter,
      openReadonly: (sessionId) => {
        openedSessions.push(sessionId)
        const db = env.adapter.openReadonly(sessionId)
        now += 9_000
        return db
      },
    }
    const service = createCrossChatAnalysisService({
      adapter,
      contactsService,
      now: () => now,
    })
    const result = await service.searchMessages({
      keywords: ['project alpha'],
      maxSessions: 3,
      maxEvidence: 10,
      maxWallTimeMs: 8_000,
    })

    assert.equal(openedSessions.length, 1)
    assert.equal(result.coverage.candidateSessions, 3)
    assert.equal(result.coverage.scannedSessions, 0)
    assert.equal(result.coverage.truncated, true)
    assert.ok(result.coverage.truncatedReasons.includes('time_budget'))
  } finally {
    env.cleanup()
  }
})

test('search honors interruption while resolving unscoped candidates', async () => {
  const { env, contactsService } = createFixture()
  try {
    const openedSessions: string[] = []
    const adapter: SessionRuntimeAdapter = {
      ...env.adapter,
      openReadonly: (sessionId) => {
        openedSessions.push(sessionId)
        return env.adapter.openReadonly(sessionId)
      },
    }
    const controller = new AbortController()
    const service = createCrossChatAnalysisService({ adapter, contactsService })
    const search = service.searchMessages({ keywords: ['project'], maxSessions: 3 }, { signal: controller.signal })

    queueMicrotask(() => controller.abort())

    await assert.rejects(search, { name: 'AbortError' })
    assert.ok(openedSessions.length > 0)
    assert.ok(openedSessions.length < adapter.listSessionCandidateIds!().length)
  } finally {
    env.cleanup()
  }
})

test('overview preserves separate member scopes for contacts in the same group', async () => {
  const { env, contactsService } = createFixture()
  try {
    const service = createCrossChatAnalysisService({ adapter: env.adapter, contactsService })
    const result = await service.getOverview({
      scopes: [
        { sessionId: 'group-work', memberIds: [20], label: 'Alice in Work group' },
        { sessionId: 'group-work', memberIds: [21], label: 'Bob in Work group' },
      ],
    })

    assert.deepEqual(
      result.items.map((item) => [item.label, item.totalMessages, item.firstMessageTs, item.lastMessageTs]),
      [
        ['Alice in Work group', 2, 300, 320],
        ['Bob in Work group', 1, 310, 310],
      ]
    )
  } finally {
    env.cleanup()
  }
})

test('cross-chat anonymization namespaces local member ids by source session', () => {
  const { env } = createFixture()
  try {
    const base = {
      sessionName: 'Session',
      sessionType: ChatType.GROUP,
      platform: 'test',
      lastMessageTs: 1,
      messageId: 1,
      senderId: 10,
      senderName: 'Alice',
      senderPlatformId: 'alice',
      content: 'hello',
      timestamp: 1,
      messageType: 0,
    }
    const config = {
      dataCleaning: false,
      mergeConsecutive: true,
      blacklistKeywords: [],
      denoise: false,
      desensitize: false,
      desensitizeRules: [],
      anonymizeNames: true,
    }
    const first = preprocessCrossChatMessages(
      env.adapter,
      'private-alice',
      [{ ...base, sessionId: 'private-alice' }],
      config
    )
    const second = preprocessCrossChatMessages(
      env.adapter,
      'group-work',
      [{ ...base, sessionId: 'group-work' }],
      config
    )

    assert.equal(first[0].senderName, 'U10@private-alice')
    assert.equal(second[0].senderName, 'U10@group-work')
  } finally {
    env.cleanup()
  }
})
