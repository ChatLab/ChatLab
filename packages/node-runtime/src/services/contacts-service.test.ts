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
import { openBetterSqliteDatabase } from '../better-sqlite3-adapter'
import type { SessionRuntimeAdapter } from './adapters'
import { createContactsService } from './contacts-service'

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

  const result = createContactsService({ adapter: env.adapter, systemDir: env.dir }).getContacts()
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
  assert.equal(result.cache.status, 'fresh')
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

  const result = createContactsService({ adapter: env.adapter, systemDir: env.dir }).getContacts()

  assert.equal(result.contacts.length, 0)
  assert.equal(result.diagnostics.privateSessionCount, 3)
  assert.equal(result.diagnostics.skippedMissingOwnerSessions, 1)
  assert.equal(result.diagnostics.skippedUnresolvedOwnerSessions, 1)
  assert.equal(result.diagnostics.skippedAmbiguousPrivateSessions, 1)
})

test('keeps name-match platform contacts session-scoped and applies manual overrides only to existing contacts', (t) => {
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

  const service = createContactsService({ adapter: env.adapter, systemDir: env.dir })
  service.setContactOverride('whatsapp:whatsapp-a:Alice', { lockedTier: 'core' })
  service.setContactOverride('whatsapp:ghost:Alice', { lockedTier: 'core' })
  const result = service.getContacts()
  const keys = result.contacts.map((contact) => contact.key).sort()

  assert.deepEqual(keys, ['whatsapp:whatsapp-a:Alice', 'whatsapp:whatsapp-b:Alice'])
  const locked = result.contacts.find((contact) => contact.key === 'whatsapp:whatsapp-a:Alice')
  const unlocked = result.contacts.find((contact) => contact.key === 'whatsapp:whatsapp-b:Alice')
  assert.ok(locked)
  assert.equal(locked.tier, 'core')
  assert.equal(locked.lockedTier, 'core')
  assert.ok(unlocked)
  assert.equal(unlocked.lockedTier, null)
})

test('returns stale cached contacts when signature changes and acceptStale is true', (t) => {
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

  const service = createContactsService({ adapter: env.adapter, systemDir: env.dir, now: () => now })
  const first = service.getContacts()
  assert.equal(first.cache.status, 'fresh')
  assert.equal(first.cache.computedAt, 1000)

  now = 2000
  fs.utimesSync(env.dbPath('private-a'), new Date(), new Date(Date.now() + 5000))

  const stale = service.getContacts({ acceptStale: true })
  assert.equal(stale.cache.status, 'stale')
  assert.equal(stale.cache.computedAt, 1000)
  assert.deepEqual(
    stale.contacts.map((contact) => contact.key),
    first.contacts.map((contact) => contact.key)
  )

  const fresh = service.getContacts()
  assert.equal(fresh.cache.status, 'fresh')
  assert.equal(fresh.cache.computedAt, 2000)
})

test('recomputes contacts after owner_id changes in a session database', (t) => {
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

  const service = createContactsService({ adapter: env.adapter, systemDir: env.dir, now: () => now })
  const first = service.getContacts()
  assert.deepEqual(
    first.contacts.map((contact) => contact.key),
    ['weixin:alice']
  )

  now = 2000
  env.adapter.ensureWritable('private-a').prepare('UPDATE meta SET owner_id = ?').run('alice')

  const second = service.getContacts()
  assert.equal(second.cache.status, 'fresh')
  assert.equal(second.cache.computedAt, 2000)
  assert.deepEqual(
    second.contacts.map((contact) => contact.key),
    ['weixin:owner']
  )
})
