/**
 * Tests for People relationships runtime service.
 *
 * Run: pnpm test -- packages/node-runtime/src/services/people/relationships/service.test.ts
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { PeopleRelationshipGraphEdge, PeopleRelationshipGraphNode } from '@openchatlab/shared-types'
import type { SessionRuntimeAdapter } from '../../adapters'
import { PEOPLE_RELATIONSHIPS_ALGORITHM_VERSION, type PeopleRelationshipsSnapshot } from './compute'
import { createPeopleRelationshipsService } from './service'

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir(), 'chatlab-rel-service-'))
}

function makeNode(overrides: Partial<PeopleRelationshipGraphNode> & { key: string }): PeopleRelationshipGraphNode {
  return {
    key: overrides.key,
    kind: overrides.kind,
    platform: 'weixin',
    platformId: overrides.platformId ?? overrides.key.split(':').at(-1) ?? overrides.key,
    sessionScoped: false,
    displayName: overrides.displayName ?? overrides.key,
    aliases: overrides.aliases ?? [],
    avatar: overrides.avatar ?? null,
    pool: overrides.pool ?? 'non_friend',
    score: overrides.score ?? 1,
    rank: overrides.rank ?? 1,
    communityId: overrides.communityId ?? 'group:g1',
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    size: overrides.size ?? 8,
    color: overrides.color ?? '#7dd3fc',
    labelVisibility: overrides.labelVisibility ?? 1,
    lastInteractionTs: overrides.lastInteractionTs ?? null,
    privateMessageCount: overrides.privateMessageCount ?? 0,
    groupMessageCount: overrides.groupMessageCount ?? 1,
    commonGroupCount: overrides.commonGroupCount ?? 1,
    searchText: overrides.searchText ?? `${overrides.displayName ?? overrides.key} ${overrides.key}`.toLowerCase(),
    ...(overrides.friendSource ? { friendSource: overrides.friendSource } : {}),
    ...(overrides.sessionId ? { sessionId: overrides.sessionId } : {}),
  }
}

function makeSnapshot(signature: string): PeopleRelationshipsSnapshot {
  const owner = makeNode({
    key: 'owner:weixin',
    kind: 'owner',
    platformId: 'owner',
    displayName: 'Me',
    pool: 'friend',
    rank: 1,
    score: 120,
    searchText: 'me owner 我',
  })
  const alice = makeNode({
    key: 'weixin:alice',
    platformId: 'alice',
    displayName: 'Alice',
    pool: 'friend',
    friendSource: 'private',
    rank: 2,
    score: 90,
  })
  const bob = makeNode({ key: 'weixin:bob', platformId: 'bob', displayName: 'Bob', rank: 3, score: 70 })
  const carol = makeNode({ key: 'weixin:carol', platformId: 'carol', displayName: 'Carol', rank: 4, score: 10 })
  const edge = {
    id: 'weixin:alice__weixin:bob',
    sourceKey: alice.key,
    targetKey: bob.key,
    weight: 8,
    coOccurrenceCount: 2,
    coOccurrenceRawScore: 2,
    replyInteractionCount: 1,
    repliesFromSourceToTarget: 0,
    repliesFromTargetToSource: 1,
    sourceGroupCount: 1,
    sourceSessionIds: ['group-a'],
    lastInteractionTs: 1704103202,
    visibility: 2 as const,
  }
  return {
    nodes: [owner, alice, bob, carol],
    edges: [edge],
    communities: [{ id: 'group:g1', label: 'Group', size: 4, x: 0, y: 0, color: '#7dd3fc' }],
    graph: {
      nodes: [owner, alice, bob],
      edges: [edge],
      communities: [{ id: 'group:g1', label: 'Group', size: 4, x: 0, y: 0, color: '#7dd3fc' }],
    },
    diagnostics: {
      processedPrivateSessions: 1,
      processedGroupSessions: 1,
      skippedMissingOwnerSessions: 0,
      skippedUnresolvedOwnerSessions: 0,
      skippedAmbiguousPrivateSessions: 0,
      skippedFailedSessions: 0,
      totalNodes: 4,
      totalEdges: 1,
      panoramaIncludedGroupSessions: 0,
      panoramaExcludedLowValueGroupSessions: 0,
      panoramaIncludedGroupMembers: 0,
      panoramaExcludedGroupMembers: 0,
      panoramaCandidateNodes: 3,
      panoramaGroupInclusionReasons: {},
      coreNodeCount: 3,
      coreEdgeCount: 1,
      warnings: [],
    },
    algorithmVersion: PEOPLE_RELATIONSHIPS_ALGORITHM_VERSION,
    signature,
    timeRange: { preset: '1y', anchorTs: null, startTs: null },
    computedAt: 1800000000,
    workerStats: { durationMs: 1, totalSessions: 2, processedSessions: 2, skippedFailedSessions: 0 },
    limits: {
      coreNodeLimit: 3,
      coreEdgeLimit: 1,
      perNodeEdgeLimit: 1,
      neighborhoodNodeLimit: 80,
      neighborhoodEdgeLimit: 240,
      searchResultLimit: 20,
    },
  }
}

function makeEdge(sourceKey: string, targetKey: string, weight: number): PeopleRelationshipGraphEdge {
  return {
    id: `${sourceKey}__${targetKey}`,
    sourceKey,
    targetKey,
    weight,
    coOccurrenceCount: Math.round(weight),
    coOccurrenceRawScore: weight,
    replyInteractionCount: 0,
    repliesFromSourceToTarget: 0,
    repliesFromTargetToSource: 0,
    sourceGroupCount: 1,
    sourceSessionIds: ['group-a'],
    lastInteractionTs: 1704103202,
    visibility: 1,
  }
}

function makeAdapter(signatureSeed = 'stable'): SessionRuntimeAdapter {
  return {
    listSessionIds: () => ['session-a'],
    openReadonly: () => null,
    openWritable: () => null,
    closeSession: () => {},
    getDbPath: () => path.join('/tmp', `chatlab-${signatureSeed}.db`),
    deleteSessionFile: () => false,
    ensureReadonly: () => {
      throw new Error('not used')
    },
    ensureWritable: () => {
      throw new Error('not used')
    },
  } as SessionRuntimeAdapter
}

function makeFreshSignature(): string {
  return `algorithm:${PEOPLE_RELATIONSHIPS_ALGORITHM_VERSION}|range:1y|session-a:missing`
}

test('returns search results from all snapshot nodes, including nodes outside the core graph', () => {
  const dir = makeTempDir()
  try {
    const service = createPeopleRelationshipsService({
      adapter: makeAdapter(),
      systemDir: dir,
      runner: async () => {
        throw new Error('runner should not be called for fresh injected snapshot')
      },
    })
    service.replaceSnapshotForTests?.(makeSnapshot(makeFreshSignature()))

    const response = service.getGraph({ acceptStale: true, query: 'carol' })

    assert.equal(
      response.graph.nodes.some((node) => node.key === 'weixin:carol'),
      false
    )
    assert.deepEqual(
      response.searchResults.map((result) => [result.key, result.inCoreGraph]),
      [['weixin:carol', false]]
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('returns the owner node from full snapshot search', () => {
  const dir = makeTempDir()
  try {
    const service = createPeopleRelationshipsService({
      adapter: makeAdapter(),
      systemDir: dir,
      runner: async () => {
        throw new Error('runner should not be called for fresh injected snapshot')
      },
    })
    service.replaceSnapshotForTests?.(makeSnapshot(makeFreshSignature()))

    const response = service.getGraph({ acceptStale: true, query: '我' })

    assert.deepEqual(
      response.searchResults.map((result) => [result.key, result.kind, result.inCoreGraph]),
      [['owner:weixin', 'owner', true]]
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('returns a close relationships graph with owner, all friends, and top scored groupmates', () => {
  const dir = makeTempDir()
  try {
    const service = createPeopleRelationshipsService({
      adapter: makeAdapter(),
      systemDir: dir,
      runner: async () => {
        throw new Error('runner should not be called for fresh injected snapshot')
      },
    })
    const snapshot = makeSnapshot(makeFreshSignature())
    const offCoreFriend = makeNode({
      key: 'weixin:off-core-friend',
      displayName: 'Off Core Friend',
      pool: 'friend',
      friendSource: 'manual',
      rank: 80,
      score: 45,
    })
    const groupmates = Array.from({ length: 55 }, (_, index) =>
      makeNode({
        key: `weixin:groupmate-${index + 1}`,
        displayName: `Groupmate ${index + 1}`,
        pool: 'non_friend',
        rank: 100 + index,
        score: 100 - index,
      })
    )
    snapshot.nodes = [...snapshot.nodes, offCoreFriend, ...groupmates]
    snapshot.edges = [
      ...snapshot.edges,
      makeEdge('owner:weixin', offCoreFriend.key, 9),
      ...groupmates.map((node, index) => makeEdge('owner:weixin', node.key, 60 - index)),
    ]
    service.replaceSnapshotForTests?.(snapshot)

    const response = service.getGraph({ acceptStale: true, graphScope: 'close' })
    const keys = response.graph.nodes.map((node) => node.key)
    const groupmateKeys = response.graph.nodes.filter((node) => node.pool === 'non_friend').map((node) => node.key)

    assert.ok(keys.includes('owner:weixin'))
    assert.ok(keys.includes('weixin:alice'))
    assert.ok(keys.includes(offCoreFriend.key))
    assert.equal(groupmateKeys.length, 50)
    assert.ok(groupmateKeys.includes('weixin:groupmate-1'))
    assert.ok(!groupmateKeys.includes('weixin:groupmate-55'))
    assert.ok(response.graph.edges.every((edge) => keys.includes(edge.sourceKey) && keys.includes(edge.targetKey)))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('returns neighborhood graph for a searched node outside the core graph', () => {
  const dir = makeTempDir()
  try {
    const service = createPeopleRelationshipsService({
      adapter: makeAdapter(),
      systemDir: dir,
      runner: async () => {
        throw new Error('runner should not be called for fresh injected snapshot')
      },
    })
    service.replaceSnapshotForTests?.(makeSnapshot(makeFreshSignature()))

    const response = service.getNeighborhood('weixin:carol', { acceptStale: true })

    assert.equal(response.contact?.key, 'weixin:carol')
    assert.deepEqual(
      response.graph.nodes.map((node) => node.key),
      ['weixin:carol']
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('starts a background task when snapshot is missing and returns task state immediately', async () => {
  const dir = makeTempDir()
  try {
    let runnerCalls = 0
    let releaseRunner!: (snapshot: PeopleRelationshipsSnapshot) => void
    const service = createPeopleRelationshipsService({
      adapter: makeAdapter(),
      systemDir: dir,
      runner: () => {
        runnerCalls++
        return new Promise<PeopleRelationshipsSnapshot>((resolve) => {
          releaseRunner = resolve
        })
      },
      now: () => 1800000000,
    })

    const response = service.getGraph({ acceptStale: true })

    assert.equal(response.cache.status, 'missing')
    assert.equal(response.task?.status, 'running')
    assert.equal(runnerCalls, 1)
    releaseRunner(makeSnapshot(makeFreshSignature()))
    await new Promise((resolve) => setTimeout(resolve, 0))
    await service.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
