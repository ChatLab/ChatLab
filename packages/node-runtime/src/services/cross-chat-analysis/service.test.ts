import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { CHAT_DB_SCHEMA } from '@openchatlab/core'
import type { DatabaseAdapter } from '@openchatlab/core'
import type { ContactDetailResponse, ContactItem } from '@openchatlab/shared-types'
import { openBetterSqliteDatabase } from '../../better-sqlite3-adapter'
import type { ContactsService } from '../contacts'
import type { SessionRuntimeAdapter } from '../adapters'
import { createCrossChatAnalysisService } from './service'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

interface SeedSession {
  id: string
  name: string
  type: 'private' | 'group'
  members: Array<{ id: number; platformId: string; name: string }>
  messages: Array<{ id: number; senderId: number; ts: number; content: string }>
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
    db.prepare('INSERT INTO meta (name, platform, type, imported_at) VALUES (?, ?, ?, ?)').run(
      session.name,
      'test',
      session.type,
      1780000000
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
        'INSERT INTO message (id, sender_id, ts, type, content, platform_message_id) VALUES (?, ?, ?, 0, ?, ?)'
      ).run(message.id, message.senderId, message.ts, message.content, `${session.id}-${message.id}`)
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
  contactsService: Pick<ContactsService, 'getContactDetail'>
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

  const contacts = new Map<string, ContactDetailResponse>([
    [
      'test:alice',
      detail(
        contact({
          key: 'test:alice',
          platformId: 'alice',
          displayName: 'Alice',
          sourceSessions: [
            { id: 'private-alice', name: 'Alice private', platform: 'test', type: 'private' },
            { id: 'group-work', name: 'Work group', platform: 'test', type: 'group' },
          ],
        })
      ),
    ],
    [
      'test:group-other:alice-other',
      detail(
        contact({
          key: 'test:group-other:alice-other',
          platformId: 'alice-other',
          displayName: 'Alice',
          sessionScoped: true,
          sessionId: 'group-other',
          sourceSessions: [{ id: 'group-other', name: 'Other group', platform: 'test', type: 'group' }],
        })
      ),
    ],
  ])
  return {
    env,
    contactsService: {
      getContactDetail: (key) => contacts.get(key) ?? detail(null),
    },
  }
}

test('entity resolution uses contact keys and resolves per-session member ids without merging display names', () => {
  const { env, contactsService } = createFixture()
  try {
    const service = createCrossChatAnalysisService({ adapter: env.adapter, contactsService })
    const result = service.resolveEntities([
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

test('search rejects empty keywords and honors interruption before scanning', async () => {
  const { env, contactsService } = createFixture()
  try {
    const service = createCrossChatAnalysisService({ adapter: env.adapter, contactsService })
    await assert.rejects(() => service.searchMessages({ keywords: [] }), /keyword/i)

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

test('search stops between sessions when the wall-time budget is exhausted', async () => {
  const { env, contactsService } = createFixture()
  try {
    const timestamps = [0, 0, 9_000]
    const service = createCrossChatAnalysisService({
      adapter: env.adapter,
      contactsService,
      now: () => timestamps.shift() ?? 9_000,
    })
    const result = await service.searchMessages({
      keywords: ['project alpha'],
      maxSessions: 3,
      maxEvidence: 10,
      maxWallTimeMs: 8_000,
    })

    assert.equal(result.coverage.scannedSessions, 1)
    assert.equal(result.coverage.truncated, true)
    assert.ok(result.coverage.truncatedReasons.includes('time_budget'))
  } finally {
    env.cleanup()
  }
})

test('overview returns separate scoped totals instead of combining unrelated senders', async () => {
  const { env, contactsService } = createFixture()
  try {
    const service = createCrossChatAnalysisService({ adapter: env.adapter, contactsService })
    const result = await service.getOverview({
      scopes: [
        { sessionId: 'group-work', memberIds: [20], label: 'Alice in Work group' },
        { sessionId: 'group-other', memberIds: [30], label: 'Other Alice' },
      ],
    })

    assert.deepEqual(
      result.items.map((item) => [item.label, item.totalMessages, item.firstMessageTs, item.lastMessageTs]),
      [
        ['Alice in Work group', 2, 300, 320],
        ['Other Alice', 1, 200, 200],
      ]
    )
  } finally {
    env.cleanup()
  }
})
