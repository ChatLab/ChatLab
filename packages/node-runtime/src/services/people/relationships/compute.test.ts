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
import type { PeopleRelationshipGraphEdge, PeopleRelationshipGraphNode } from '@openchatlab/shared-types'
import type { DatabaseAdapter } from '@openchatlab/core'
import { openBetterSqliteDatabase } from '../../../better-sqlite3-adapter'
import type { SessionRuntimeAdapter } from '../../adapters'
import {
  buildPeopleRelationshipsNeighborhoodGraph,
  computePeopleRelationshipsSnapshot,
  PEOPLE_RELATIONSHIPS_ALGORITHM_VERSION,
  type PeopleRelationshipsSnapshot,
} from './compute'

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

function makeGraphNode(overrides: Partial<PeopleRelationshipGraphNode> & { key: string }): PeopleRelationshipGraphNode {
  return {
    key: overrides.key,
    kind: overrides.kind ?? 'contact',
    platform: overrides.platform ?? 'weixin',
    platformId: overrides.platformId ?? overrides.key.split(':').at(-1) ?? overrides.key,
    sessionScoped: false,
    displayName: overrides.displayName ?? overrides.key,
    aliases: [],
    avatar: null,
    pool: overrides.pool ?? 'non_friend',
    friendSource: overrides.friendSource,
    score: overrides.score ?? 0.5,
    rank: overrides.rank ?? 10,
    communityId: overrides.communityId ?? 'group:small',
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    size: overrides.size ?? 8,
    color: overrides.color ?? '#7dd3fc',
    labelVisibility: overrides.labelVisibility ?? 1,
    lastInteractionTs: overrides.lastInteractionTs ?? null,
    privateMessageCount: overrides.privateMessageCount ?? 0,
    groupMessageCount: overrides.groupMessageCount ?? 0,
    commonGroupCount: overrides.commonGroupCount ?? 1,
    searchText: overrides.searchText ?? overrides.key,
  }
}

function makeGraphEdge(sourceKey: string, targetKey: string, weight: number): PeopleRelationshipGraphEdge {
  return {
    id: `${sourceKey}__${targetKey}`,
    sourceKey,
    targetKey,
    weight,
    coOccurrenceCount: Math.max(1, Math.round(weight)),
    coOccurrenceRawScore: weight,
    replyInteractionCount: 0,
    repliesFromSourceToTarget: 0,
    repliesFromTargetToSource: 0,
    sourceGroupCount: 1,
    sourceSessionIds: ['group-small'],
    lastInteractionTs: 1704103200,
    visibility: weight >= 8 ? 2 : 1,
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
      { id: 5, platformId: 'group-a', accountName: 'group-a' },
    ],
    messages: [
      { id: 1, senderId: 2, ts: 1704103200, platformMessageId: 'alice-1' },
      { id: 2, senderId: 3, ts: 1704103201, platformMessageId: 'bob-1', replyToMessageId: 'alice-1' },
      { id: 3, senderId: 4, ts: 1704103900, platformMessageId: 'carol-1' },
      { id: 4, senderId: 5, ts: 1704103901, platformMessageId: 'group-self-1' },
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
    snapshot.nodes.some((node) => node.platformId === 'group-a'),
    false
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

test('prioritizes contact score over noisy group activity for the default panorama', (t) => {
  const env = new TestEnv()
  t.after(() => env.cleanup())

  env.seed({
    id: 'private-close',
    platform: 'weixin',
    type: 'private',
    ownerId: 'owner',
    members: [
      { id: 1, platformId: 'owner', accountName: 'Me' },
      { id: 2, platformId: 'close', accountName: 'Close Friend' },
    ],
    messages: [
      { id: 1, senderId: 1, ts: 1704103200 },
      { id: 2, senderId: 2, ts: 1704103201 },
    ],
  })
  env.seed({
    id: 'group-noisy',
    platform: 'weixin',
    type: 'group',
    ownerId: 'owner',
    members: [
      { id: 1, platformId: 'owner', accountName: 'Me' },
      { id: 2, platformId: 'noisy', accountName: 'Noisy Groupmate' },
      { id: 3, platformId: 'speaker', accountName: 'Speaker' },
    ],
    messages: [
      ...Array.from({ length: 80 }, (_, index) => ({
        id: index + 1,
        senderId: index % 2 === 0 ? 2 : 3,
        ts: 1704103300 + index,
        platformMessageId: `group-${index + 1}`,
      })),
    ],
  })

  const snapshot = computePeopleRelationshipsSnapshot({
    adapter: env.adapter,
    signature: 'sig-1',
    timeRangePreset: 'all',
    limits: {
      coreNodeLimit: 2,
      coreEdgeLimit: 10,
      perNodeEdgeLimit: 10,
    },
  })

  assert.equal(
    snapshot.nodes.some((node) => node.platformId === 'noisy'),
    true
  )
  assert.equal(
    snapshot.graph.nodes.some((node) => node.platformId === 'close'),
    true
  )
  assert.equal(
    snapshot.graph.nodes.some((node) => node.platformId === 'noisy'),
    false
  )
})

test('keeps top friend contacts ahead of non-friend contacts in the default panorama', (t) => {
  const env = new TestEnv()
  t.after(() => env.cleanup())

  for (const [index, contactId] of ['friend-1', 'friend-2', 'friend-3'].entries()) {
    env.seed({
      id: `private-${contactId}`,
      platform: 'weixin',
      type: 'private',
      ownerId: 'owner',
      members: [
        { id: 1, platformId: 'owner', accountName: 'Me' },
        { id: 2, platformId: contactId, accountName: contactId },
      ],
      messages: Array.from({ length: 8 - index }, (_, messageIndex) => ({
        id: messageIndex + 1,
        senderId: messageIndex % 2 === 0 ? 1 : 2,
        ts: 1704103200 + index * 100 + messageIndex,
      })),
    })
  }

  env.seed({
    id: 'group-strong-non-friend',
    platform: 'weixin',
    type: 'group',
    ownerId: 'owner',
    members: [
      { id: 1, platformId: 'owner', accountName: 'Me' },
      { id: 2, platformId: 'groupmate', accountName: 'Strong Groupmate' },
    ],
    messages: [
      { id: 1, senderId: 1, ts: 1704104000, platformMessageId: 'owner-1' },
      { id: 2, senderId: 2, ts: 1704104001, platformMessageId: 'groupmate-1', replyToMessageId: 'owner-1' },
    ],
  })

  const snapshot = computePeopleRelationshipsSnapshot({
    adapter: env.adapter,
    signature: 'sig-1',
    timeRangePreset: 'all',
    limits: {
      coreNodeLimit: 4,
      coreEdgeLimit: 10,
      perNodeEdgeLimit: 10,
    },
  })

  const corePlatformIds = snapshot.graph.nodes.map((node) => node.platformId)
  assert.deepEqual(corePlatformIds, ['owner', 'friend-1', 'friend-2', 'friend-3'])
})

test('lays out the panorama around owner and pushes large noisy groups outward', (t) => {
  const env = new TestEnv()
  t.after(() => env.cleanup())

  env.seed({
    id: 'private-close',
    platform: 'weixin',
    type: 'private',
    ownerId: 'owner',
    members: [
      { id: 1, platformId: 'owner', accountName: 'Me' },
      { id: 2, platformId: 'close-friend', accountName: 'Close Friend' },
    ],
    messages: Array.from({ length: 40 }, (_, index) => ({
      id: index + 1,
      senderId: index % 2 === 0 ? 1 : 2,
      ts: 1704103200 + index,
    })),
  })
  env.seed({
    id: 'private-anchor',
    platform: 'weixin',
    type: 'private',
    ownerId: 'owner',
    members: [
      { id: 1, platformId: 'owner', accountName: 'Me' },
      { id: 2, platformId: 'anchor-friend', accountName: 'Anchor Friend' },
    ],
    messages: [
      { id: 1, senderId: 1, ts: 1704103000 },
      { id: 2, senderId: 2, ts: 1704103001 },
    ],
  })
  env.seed({
    id: 'group-small',
    platform: 'weixin',
    type: 'group',
    ownerId: 'owner',
    members: [
      { id: 1, platformId: 'owner', accountName: 'Me' },
      { id: 2, platformId: 'anchor-friend', accountName: 'Anchor Friend' },
      { id: 3, platformId: 'small-peer', accountName: 'Small Peer' },
    ],
    messages: [
      ...Array.from({ length: 22 }, (_, index) => ({
        id: index + 1,
        senderId: 1,
        ts: 1704104000 + index,
        platformMessageId: `small-owner-${index + 1}`,
      })),
      { id: 23, senderId: 3, ts: 1704104100, platformMessageId: 'small-peer-1', replyToMessageId: 'small-owner-1' },
    ],
  })
  env.seed({
    id: 'group-large',
    platform: 'weixin',
    type: 'group',
    ownerId: 'owner',
    members: [
      { id: 1, platformId: 'owner', accountName: 'Me' },
      { id: 2, platformId: 'anchor-friend', accountName: 'Anchor Friend' },
      { id: 3, platformId: 'large-peer', accountName: 'Large Peer' },
      ...Array.from({ length: 45 }, (_, index) => ({
        id: index + 4,
        platformId: `large-quiet-${index + 1}`,
        accountName: `Large Quiet ${index + 1}`,
      })),
    ],
    messages: [
      ...Array.from({ length: 22 }, (_, index) => ({
        id: index + 1,
        senderId: 1,
        ts: 1704105000 + index,
        platformMessageId: `large-owner-${index + 1}`,
      })),
      { id: 23, senderId: 3, ts: 1704105100, platformMessageId: 'large-peer-1', replyToMessageId: 'large-owner-1' },
      ...Array.from({ length: 45 }, (_, index) => ({
        id: index + 24,
        senderId: index + 4,
        ts: 1704105200 + index,
        platformMessageId: `large-quiet-${index + 1}`,
      })),
    ],
  })

  const snapshot = computePeopleRelationshipsSnapshot({
    adapter: env.adapter,
    signature: 'sig-1',
    timeRangePreset: 'all',
    limits: {
      coreNodeLimit: 80,
      coreEdgeLimit: 80,
      perNodeEdgeLimit: 20,
    },
  })

  const owner = snapshot.nodes.find((node) => node.kind === 'owner')
  const closeFriend = snapshot.nodes.find((node) => node.platformId === 'close-friend')
  const smallPeer = snapshot.nodes.find((node) => node.platformId === 'small-peer')
  const largePeer = snapshot.nodes.find((node) => node.platformId === 'large-peer')
  assert.ok(owner)
  assert.ok(closeFriend)
  assert.ok(smallPeer)
  assert.ok(largePeer)

  const distanceOf = (node: { x: number; y: number }) => Math.hypot(node.x, node.y)

  assert.deepEqual([owner.x, owner.y], [0, 0])
  assert.ok(distanceOf(closeFriend) < distanceOf(smallPeer))
  assert.ok(distanceOf(smallPeer) < distanceOf(largePeer))
})

test('excludes no-friend groups from the default panorama while keeping full relationship data', (t) => {
  const env = new TestEnv()
  t.after(() => env.cleanup())

  env.seed({
    id: 'group-no-friends',
    platform: 'weixin',
    type: 'group',
    ownerId: 'owner',
    members: [
      { id: 1, platformId: 'owner', accountName: 'Me' },
      { id: 2, platformId: 'alpha', accountName: 'Alpha' },
      { id: 3, platformId: 'beta', accountName: 'Beta' },
    ],
    messages: [
      { id: 1, senderId: 2, ts: 1704103200, platformMessageId: 'alpha-1' },
      { id: 2, senderId: 3, ts: 1704103201, platformMessageId: 'beta-1', replyToMessageId: 'alpha-1' },
    ],
  })

  const snapshot = computePeopleRelationshipsSnapshot({
    adapter: env.adapter,
    signature: 'sig-1',
    timeRangePreset: 'all',
    limits: {
      coreNodeLimit: 10,
      coreEdgeLimit: 10,
      perNodeEdgeLimit: 10,
    },
  })

  const alpha = snapshot.nodes.find((node) => node.platformId === 'alpha')
  assert.ok(alpha)
  assert.equal(
    snapshot.graph.nodes.some((node) => node.platformId === 'alpha'),
    false
  )
  assert.equal(snapshot.graph.edges.length, 0)

  const neighborhood = buildPeopleRelationshipsNeighborhoodGraph(snapshot, alpha.key)
  assert.equal(
    neighborhood.nodes.some((node) => node.platformId === 'beta'),
    true
  )
  assert.equal(neighborhood.edges.length > 0, true)
  assert.equal(snapshot.diagnostics.panoramaExcludedLowValueGroupSessions, 1)
  assert.equal(snapshot.diagnostics.panoramaIncludedGroupSessions, 0)
})

test('relayouts neighborhood graphs around the focused contact', () => {
  const center = makeGraphNode({
    key: 'weixin:alice',
    platformId: 'alice',
    displayName: 'Alice',
    pool: 'friend',
    rank: 6,
    score: 0.88,
    communityId: 'group:small',
    x: 900,
    y: 700,
    privateMessageCount: 12,
  })
  const closeSmallGroupPeer = makeGraphNode({
    key: 'weixin:bob',
    platformId: 'bob',
    displayName: 'Bob',
    rank: 12,
    score: 0.76,
    communityId: 'group:small',
    x: 920,
    y: 720,
  })
  const weakPeer = makeGraphNode({
    key: 'weixin:carol',
    platformId: 'carol',
    displayName: 'Carol',
    rank: 90,
    score: 0.22,
    communityId: 'group:large',
    x: 940,
    y: 730,
  })
  const unrelated = makeGraphNode({
    key: 'weixin:dave',
    platformId: 'dave',
    displayName: 'Dave',
    rank: 60,
    score: 0.4,
    communityId: 'group:small',
    x: 960,
    y: 740,
  })
  const snapshot = {
    nodes: [center, closeSmallGroupPeer, weakPeer, unrelated],
    edges: [
      makeGraphEdge(center.key, closeSmallGroupPeer.key, 12),
      makeGraphEdge(center.key, weakPeer.key, 0.4),
      makeGraphEdge(closeSmallGroupPeer.key, unrelated.key, 5),
    ],
    communities: [
      { id: 'group:small', label: 'Small Group', size: 3, x: 0, y: 0, color: '#7dd3fc' },
      { id: 'group:large', label: 'Large Group', size: 1, x: 0, y: 0, color: '#f0abfc' },
    ],
    graph: { nodes: [], edges: [], communities: [] },
    diagnostics: {
      processedPrivateSessions: 0,
      processedGroupSessions: 0,
      skippedMissingOwnerSessions: 0,
      skippedUnresolvedOwnerSessions: 0,
      skippedAmbiguousPrivateSessions: 0,
      skippedFailedSessions: 0,
      totalNodes: 4,
      totalEdges: 3,
      panoramaIncludedGroupSessions: 0,
      panoramaExcludedLowValueGroupSessions: 0,
      panoramaIncludedGroupMembers: 0,
      panoramaExcludedGroupMembers: 0,
      panoramaCandidateNodes: 4,
      panoramaGroupInclusionReasons: {},
      coreNodeCount: 0,
      coreEdgeCount: 0,
      warnings: [],
    },
    algorithmVersion: PEOPLE_RELATIONSHIPS_ALGORITHM_VERSION,
    signature: 'sig-local-layout',
    timeRange: { preset: 'all', anchorTs: null, startTs: null },
    computedAt: 1800000000,
    workerStats: { durationMs: 1, totalSessions: 0, processedSessions: 0, skippedFailedSessions: 0 },
    limits: {
      coreNodeLimit: 10,
      coreEdgeLimit: 10,
      perNodeEdgeLimit: 10,
      neighborhoodNodeLimit: 10,
      neighborhoodEdgeLimit: 10,
      searchResultLimit: 20,
    },
  } satisfies PeopleRelationshipsSnapshot

  const neighborhood = buildPeopleRelationshipsNeighborhoodGraph(snapshot, center.key)
  const localCenter = neighborhood.nodes.find((node) => node.key === center.key)
  const localClosePeer = neighborhood.nodes.find((node) => node.key === closeSmallGroupPeer.key)
  const localWeakPeer = neighborhood.nodes.find((node) => node.key === weakPeer.key)
  assert.ok(localCenter)
  assert.ok(localClosePeer)
  assert.ok(localWeakPeer)

  const distanceOf = (node: PeopleRelationshipGraphNode) => Math.hypot(node.x, node.y)

  assert.deepEqual([localCenter.x, localCenter.y], [0, 0])
  assert.ok(distanceOf(localClosePeer) < distanceOf(localWeakPeer))
  assert.equal(center.x, 900)
  assert.equal(center.y, 700)
})

test('includes groups with few friends when owner activity is high but trims low-signal members', (t) => {
  const env = new TestEnv()
  t.after(() => env.cleanup())

  for (const friendId of ['friend-1', 'friend-2']) {
    env.seed({
      id: `private-${friendId}`,
      platform: 'weixin',
      type: 'private',
      ownerId: 'owner',
      members: [
        { id: 1, platformId: 'owner', accountName: 'Me' },
        { id: 2, platformId: friendId, accountName: friendId },
      ],
      messages: [
        { id: 1, senderId: 1, ts: 1704103000 },
        { id: 2, senderId: 2, ts: 1704103001 },
      ],
    })
  }

  env.seed({
    id: 'group-owner-active',
    platform: 'weixin',
    type: 'group',
    ownerId: 'owner',
    members: [
      { id: 1, platformId: 'owner', accountName: 'Me' },
      { id: 2, platformId: 'friend-1', accountName: 'friend-1' },
      { id: 3, platformId: 'friend-2', accountName: 'friend-2' },
      { id: 4, platformId: 'active-peer', accountName: 'Active Peer' },
      ...Array.from({ length: 24 }, (_, index) => ({
        id: index + 5,
        platformId: `quiet-${index + 1}`,
        accountName: `Quiet ${index + 1}`,
      })),
    ],
    messages: [
      ...Array.from({ length: 22 }, (_, index) => ({
        id: index + 1,
        senderId: 1,
        ts: 1704104000 + index,
        platformMessageId: `owner-${index + 1}`,
      })),
      { id: 23, senderId: 4, ts: 1704104100, platformMessageId: 'active-peer-1', replyToMessageId: 'owner-1' },
    ],
  })

  const snapshot = computePeopleRelationshipsSnapshot({
    adapter: env.adapter,
    signature: 'sig-1',
    timeRangePreset: 'all',
    limits: {
      coreNodeLimit: 30,
      coreEdgeLimit: 30,
      perNodeEdgeLimit: 10,
    },
  })

  assert.equal(
    snapshot.graph.nodes.some((node) => node.platformId === 'friend-1'),
    true
  )
  assert.equal(
    snapshot.graph.nodes.some((node) => node.platformId === 'friend-2'),
    true
  )
  assert.equal(
    snapshot.graph.nodes.some((node) => node.platformId === 'active-peer'),
    true
  )
  assert.equal(
    snapshot.nodes.some((node) => node.platformId === 'quiet-1'),
    true
  )
  assert.equal(
    snapshot.graph.nodes.some((node) => node.platformId === 'quiet-1'),
    false
  )
  assert.equal(snapshot.diagnostics.panoramaIncludedGroupSessions, 1)
  assert.equal(snapshot.diagnostics.panoramaGroupInclusionReasons.owner_activity, 1)
  assert.ok(snapshot.diagnostics.panoramaExcludedGroupMembers > 0)
})

test('excludes large low-value groups with only a few friends from the default edge set', (t) => {
  const env = new TestEnv()
  t.after(() => env.cleanup())

  for (const friendId of ['friend-1', 'friend-2']) {
    env.seed({
      id: `private-low-${friendId}`,
      platform: 'weixin',
      type: 'private',
      ownerId: 'owner',
      members: [
        { id: 1, platformId: 'owner', accountName: 'Me' },
        { id: 2, platformId: friendId, accountName: friendId },
      ],
      messages: [
        { id: 1, senderId: 1, ts: 1704103000 },
        { id: 2, senderId: 2, ts: 1704103001 },
      ],
    })
  }

  env.seed({
    id: 'group-large-low-value',
    platform: 'weixin',
    type: 'group',
    ownerId: 'owner',
    members: [
      { id: 1, platformId: 'owner', accountName: 'Me' },
      { id: 2, platformId: 'friend-1', accountName: 'friend-1' },
      { id: 3, platformId: 'friend-2', accountName: 'friend-2' },
      { id: 4, platformId: 'stranger', accountName: 'Stranger' },
      ...Array.from({ length: 32 }, (_, index) => ({
        id: index + 5,
        platformId: `large-quiet-${index + 1}`,
        accountName: `Large Quiet ${index + 1}`,
      })),
    ],
    messages: [
      { id: 1, senderId: 2, ts: 1704105000, platformMessageId: 'friend-1-group' },
      { id: 2, senderId: 4, ts: 1704105001, platformMessageId: 'stranger-group', replyToMessageId: 'friend-1-group' },
    ],
  })

  const snapshot = computePeopleRelationshipsSnapshot({
    adapter: env.adapter,
    signature: 'sig-1',
    timeRangePreset: 'all',
    limits: {
      coreNodeLimit: 20,
      coreEdgeLimit: 20,
      perNodeEdgeLimit: 10,
    },
  })

  assert.equal(
    snapshot.nodes.some((node) => node.platformId === 'stranger'),
    true
  )
  assert.equal(
    snapshot.graph.nodes.some((node) => node.platformId === 'stranger'),
    false
  )
  assert.equal(
    snapshot.graph.edges.some((edge) => edge.sourceKey === 'weixin:stranger' || edge.targetKey === 'weixin:stranger'),
    false
  )
  assert.equal(snapshot.diagnostics.panoramaExcludedLowValueGroupSessions, 1)
})
