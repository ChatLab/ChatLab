/**
 * Integration tests for the cross-session contacts service.
 *
 * Run: pnpm test -- packages/node-runtime/src/services/contacts-service.test.ts
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { CHAT_DB_SCHEMA } from '@openchatlab/core'
import type { DatabaseAdapter } from '@openchatlab/core'
import { ChatType } from '@openchatlab/shared-types'
import type { ContactsResponse } from '@openchatlab/shared-types'
import { openBetterSqliteDatabase } from '../better-sqlite3-adapter'
import type { SessionRuntimeAdapter } from './adapters'
import { CONTACTS_ALGORITHM_VERSION, computeContactsSnapshot, type ContactsSnapshot } from './contacts-compute'
import { createContactsService } from './contacts-service'
import type { PathProvider } from '@openchatlab/core'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

function makeTempDir(): string {
  const baseDir = fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir()
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-contacts-service-'))
}

interface SeedMember {
  id: number
  platformId: string
  accountName?: string
  groupNickname?: string
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
        `INSERT INTO member (id, platform_id, account_name, group_nickname, avatar) VALUES (?, ?, ?, ?, ?)`
      ).run(
        member.id,
        member.platformId,
        member.accountName ?? member.platformId,
        member.groupNickname ?? null,
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

  pathProvider(): PathProvider {
    return {
      getSystemDir: () => this.dir,
      getUserDataDir: () => this.dir,
      getDatabaseDir: () => this.dir,
      getVectorDir: () => path.join(this.dir, 'vector'),
      getAiDataDir: () => path.join(this.dir, 'ai'),
      getSettingsDir: () => path.join(this.dir, 'settings'),
      getCacheDir: () => path.join(this.dir, 'cache'),
      getTempDir: () => path.join(this.dir, 'temp'),
      getLogsDir: () => path.join(this.dir, 'logs'),
      getDownloadsDir: () => path.join(this.dir, 'downloads'),
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
      { id: 2, platformId: 'alice', accountName: 'Alice', avatar: 'alice.png' },
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
  assert.deepEqual(alice.sourceSessions.map((source) => source.id).sort(), ['group-a', 'private-a', 'private-b'])

  assert.ok(bob)
  assert.equal(bob.isFriend, false)
  assert.equal(bob.pool, 'non_friend')
  assert.equal(bob.scoreBreakdown.commonGroupCount, 1)
  assert.equal(bob.sourceSessions.length, 1)

  assert.equal(result.diagnostics.privateSessionCount, 2)
  assert.equal(result.diagnostics.contactsEnabled, false)
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

test('sorts contacts by score and marks low-signal non-friends', (t) => {
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
  assert.equal(result.contacts[1].isLowSignal, true)
  assert.equal(result.diagnostics.hiddenLowSignalNonFriends, 1)
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

async function waitForTaskSettled(service: { getContacts: (options?: { acceptStale?: boolean }) => ContactsResponse }) {
  for (let i = 0; i < 100; i++) {
    const response = service.getContacts({ acceptStale: true })
    if (response.task?.status !== 'running') return response
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return service.getContacts({ acceptStale: true })
}

function makeRuntimeSnapshot(signature: string, computedAt: number): ContactsSnapshot {
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
        isLowSignal: false,
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
      contactsEnabled: false,
      skippedMissingOwnerSessions: 0,
      skippedUnresolvedOwnerSessions: 0,
      skippedAmbiguousPrivateSessions: 0,
      skippedInvalidPlatformIdMembers: 0,
      skippedFailedSessions: 0,
      hiddenLowSignalNonFriends: 0,
      warnings: [],
    },
    algorithmVersion: CONTACTS_ALGORITHM_VERSION,
    signature,
    computedAt,
    workerStats: {
      durationMs: 10,
      totalSessions: 1,
      processedSessions: 1,
      skippedFailedSessions: 0,
    },
  }
}

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
  assert.equal(first.cache.status, 'missing')
  assert.equal(first.contacts.length, 0)
  assert.equal(first.task?.status, 'running')

  now = 2000
  pending.resolve(makeRuntimeSnapshot(runnerSignature, now))
  const finished = await waitForTaskSettled(service)

  assert.equal(finished.cache.status, 'fresh')
  assert.equal(finished.cache.computedAt, 2000)
  assert.equal(finished.contacts[0].key, 'weixin:alice')
  assert.equal(finished.task?.status, 'succeeded')
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

  const stale = service.getContacts({ acceptStale: true })
  const recompute = service.startRecompute()

  assert.equal(runCalls, 1)
  assert.equal(stale.cache.status, 'stale')
  assert.equal(stale.contacts[0].key, 'weixin:alice')
  assert.equal(stale.task?.status, 'running')
  assert.equal(recompute.task?.status, 'running')
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
  assert.equal(finished.task?.status, 'succeeded')
  assert.ok(fs.existsSync(path.join(env.dir, 'contacts-snapshot.json')))
})
