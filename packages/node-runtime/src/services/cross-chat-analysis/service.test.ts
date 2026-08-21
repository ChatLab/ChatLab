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
      'test',
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
      key: 'test:group-other:alice-other',
      platformId: 'alice-other',
      displayName: 'Alice',
      sessionScoped: true,
      sessionId: 'group-other',
      sourceSessions: [{ id: 'group-other', name: 'Other group', platform: 'test', type: ChatType.GROUP }],
    }),
  ]
  const contacts = new Map<string, ContactDetailResponse>([
    ['test:alice', detail(contactItems[0])],
    ['test:group-other:alice-other', detail(contactItems[1])],
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
      result.messages.map((message) => [message.sessionId, message.messageId, message.senderId]),
      [
        ['group-work', 1, 20],
        ['private-alice', 1, 10],
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
      ['group-work', 'group-work']
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
      [['recent-owner-session', 1, 40]]
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
