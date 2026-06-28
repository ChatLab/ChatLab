/**
 * Tests for People relationships graph snapshot computation.
 *
 * Run: pnpm test -- packages/node-runtime/src/services/people/relationships/compute.test.ts
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { CHAT_DB_SCHEMA } from '@openchatlab/core'
import type { DatabaseAdapter } from '@openchatlab/core'
import { openBetterSqliteDatabase } from '../../../better-sqlite3-adapter'
import type { SessionRuntimeAdapter } from '../../adapters'
import { computePeopleRelationshipsSnapshot, PEOPLE_RELATIONSHIPS_ALGORITHM_VERSION } from './compute'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

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
  readonly dir = fs.mkdtempSync(path.join(fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir(), 'chatlab-rel-'))
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

test('computes a cropped relationship galaxy from private contacts and group interaction edges', (t) => {
  const env = new TestEnv()
  t.after(() => env.cleanup())

  env.seed({
    id: 'private-alice',
    platform: 'weixin',
    type: 'private',
    ownerId: 'owner',
    members: [
      { id: 1, platformId: 'owner', accountName: 'Me' },
      { id: 2, platformId: 'alice', accountName: 'Alice', avatar: 'alice.png' },
    ],
    messages: [
      { id: 1, senderId: 1, ts: 1704103200 },
      { id: 2, senderId: 2, ts: 1704103201 },
    ],
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
      { id: 4, platformId: 'carol', accountName: 'Carol' },
    ],
    messages: [
      { id: 1, senderId: 2, ts: 1704103200, platformMessageId: 'alice-1' },
      { id: 2, senderId: 3, ts: 1704103201, platformMessageId: 'bob-1', replyToMessageId: 'alice-1' },
      { id: 3, senderId: 4, ts: 1704103900, platformMessageId: 'carol-1' },
    ],
  })

  const snapshot = computePeopleRelationshipsSnapshot({
    adapter: env.adapter,
    signature: 'sig-1',
    timeRangePreset: 'all',
    now: () => 1800000000,
    limits: {
      coreNodeLimit: 3,
      coreEdgeLimit: 2,
      perNodeEdgeLimit: 1,
    },
  })

  assert.equal(snapshot.algorithmVersion, PEOPLE_RELATIONSHIPS_ALGORITHM_VERSION)
  const owner = snapshot.nodes.find((node) => node.kind === 'owner')
  assert.ok(owner)
  assert.equal(owner.displayName, 'Me')
  assert.equal(owner.searchText.includes('我'), true)
  assert.equal(owner.searchText.includes('me'), true)
  assert.equal(
    snapshot.graph.nodes.some((node) => node.key === owner.key),
    true
  )
  assert.equal(
    snapshot.nodes.some((node) => node.platformId === 'carol'),
    true
  )
  assert.equal(
    snapshot.graph.nodes.some((node) => node.platformId === 'carol'),
    false
  )

  const alice = snapshot.nodes.find((node) => node.platformId === 'alice')
  assert.ok(alice)
  assert.equal(alice.pool, 'friend')
  assert.equal(alice.avatar, 'alice.png')

  const edge = snapshot.graph.edges.find((item) => {
    const endpoints = [item.sourceKey, item.targetKey].sort()
    return endpoints.join('|') === ['weixin:alice', 'weixin:bob'].sort().join('|')
  })
  assert.ok(edge)
  assert.ok(edge.coOccurrenceCount > 0)
  assert.equal(edge.replyInteractionCount, 1)
  assert.equal(
    snapshot.graph.edges.filter((item) => item.sourceKey === owner.key || item.targetKey === owner.key).length <= 1,
    true
  )
  assert.equal(snapshot.diagnostics.processedGroupSessions, 1)
  assert.equal(snapshot.diagnostics.processedPrivateSessions, 1)
})

test('prefers recent owner edges when cropping dense relationship graph edges', (t) => {
  const env = new TestEnv()
  t.after(() => env.cleanup())
  const day = 24 * 60 * 60
  const staleTs = 1700000000
  const recentTs = staleTs + day * 240

  env.seed({
    id: 'private-stale',
    platform: 'weixin',
    type: 'private',
    ownerId: 'owner',
    members: [
      { id: 1, platformId: 'owner', accountName: 'Me' },
      { id: 2, platformId: 'stale', accountName: 'Stale' },
    ],
    messages: Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      senderId: index % 2 === 0 ? 1 : 2,
      ts: staleTs + index,
    })),
  })
  env.seed({
    id: 'private-recent',
    platform: 'weixin',
    type: 'private',
    ownerId: 'owner',
    members: [
      { id: 1, platformId: 'owner', accountName: 'Me' },
      { id: 2, platformId: 'recent', accountName: 'Recent' },
    ],
    messages: Array.from({ length: 60 }, (_, index) => ({
      id: index + 1,
      senderId: index % 2 === 0 ? 1 : 2,
      ts: recentTs + index,
    })),
  })

  const snapshot = computePeopleRelationshipsSnapshot({
    adapter: env.adapter,
    signature: 'sig-1',
    timeRangePreset: 'all',
    limits: {
      coreNodeLimit: 10,
      coreEdgeLimit: 10,
      perNodeEdgeLimit: 1,
    },
  })

  const owner = snapshot.graph.nodes.find((node) => node.kind === 'owner')
  assert.ok(owner)
  const ownerEdges = snapshot.graph.edges.filter((edge) => edge.sourceKey === owner.key || edge.targetKey === owner.key)

  assert.equal(ownerEdges.length, 1)
  assert.equal(ownerEdges[0]?.targetKey, 'weixin:recent')
})

test('keeps enough owner edges for the collapsed connection ranking', (t) => {
  const env = new TestEnv()
  t.after(() => env.cleanup())

  for (let index = 0; index < 11; index++) {
    const contactId = `contact-${index + 1}`
    env.seed({
      id: `private-${contactId}`,
      platform: 'weixin',
      type: 'private',
      ownerId: 'owner',
      members: [
        { id: 1, platformId: 'owner', accountName: 'Me' },
        { id: 2, platformId: contactId, accountName: contactId },
      ],
      messages: [
        { id: 1, senderId: 1, ts: 1704103200 + index * 100 },
        { id: 2, senderId: 2, ts: 1704103201 + index * 100 },
      ],
    })
  }

  const snapshot = computePeopleRelationshipsSnapshot({
    adapter: env.adapter,
    signature: 'sig-1',
    timeRangePreset: 'all',
  })

  const owner = snapshot.graph.nodes.find((node) => node.kind === 'owner')
  assert.ok(owner)

  assert.equal(
    snapshot.graph.edges.filter((edge) => edge.sourceKey === owner.key || edge.targetKey === owner.key).length >= 10,
    true
  )
})
