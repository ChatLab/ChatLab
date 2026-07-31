import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import type { AutoImportDeps } from './auto-importer'
import { autoImportBatch } from './auto-import-batch'
import type { AutoImportTargetPlan } from './auto-import-matcher'

test('parallelizes distinct explicit targets and serializes identical targets', async () => {
  const activeTargets = new Set<string>()
  const existingSessions = new Set(['existing'])
  let active = 0
  let maxActive = 0
  const creates: string[] = []
  const appends: Array<{ sessionId: string; filePath: string }> = []

  const enter = async (target: string) => {
    assert.equal(activeTargets.has(target), false)
    activeTargets.add(target)
    active++
    maxActive = Math.max(maxActive, active)
    await delay(4)
    active--
    activeTargets.delete(target)
  }
  const deps: AutoImportDeps = {
    listSessionIds: () => [...existingSessions],
    openReadonly: () => {
      throw new Error('preflight is stubbed')
    },
    sessionExists: (sessionId) => existingSessions.has(sessionId),
    async createSession(filePath, _formatOptions, sessionId) {
      creates.push(filePath)
      assert.ok(sessionId)
      await enter(`session:${sessionId}`)
      existingSessions.add(sessionId)
      return { success: true, sessionId }
    },
    async appendSession(sessionId, filePath) {
      appends.push({ sessionId, filePath })
      await enter(`session:${sessionId}`)
      return { success: true, newMessageCount: 1 }
    },
  }

  const results = await autoImportBatch(
    [
      { filePath: 'group-a-1', sessionId: 'created-a' },
      { filePath: 'group-b', sessionId: 'created-b' },
      { filePath: 'group-a-2', sessionId: 'created-a' },
      { filePath: 'existing-1', sessionId: 'existing' },
      { filePath: 'existing-2', sessionId: 'existing' },
    ].map(({ filePath, sessionId }) => ({
      id: filePath,
      filePath,
      options: { explicitSessionId: sessionId },
    })),
    deps,
    { concurrency: 2 }
  )

  assert.equal(maxActive, 2)
  assert.deepEqual(creates.sort(), ['group-a-1', 'group-b'])
  assert.deepEqual(
    appends.sort((left, right) => left.filePath.localeCompare(right.filePath)),
    [
      { sessionId: 'existing', filePath: 'existing-1' },
      { sessionId: 'existing', filePath: 'existing-2' },
      { sessionId: 'created-a', filePath: 'group-a-2' },
    ]
  )
  assert.deepEqual(
    results.map((result) => result.status),
    ['success', 'success', 'success', 'success', 'success']
  )
})

test('re-resolves exclusive items after earlier writes to preserve serial matching semantics', async () => {
  let createdSessionId: string | undefined
  const creates: string[] = []
  const appends: string[] = []
  const deps: AutoImportDeps = {
    listSessionIds: () => (createdSessionId ? [createdSessionId] : []),
    openReadonly: () => {
      throw new Error('matcher is stubbed')
    },
    sessionExists: (sessionId) => sessionId === createdSessionId,
    resolveTarget: async () =>
      createdSessionId
        ? { action: 'incremental', sessionId: createdSessionId, matchedBy: 'trailing-messages' }
        : { action: 'create', reason: 'no-match' },
    async createSession(filePath) {
      creates.push(filePath)
      createdSessionId = 'created'
      return { success: true, sessionId: createdSessionId }
    },
    async appendSession(sessionId, filePath) {
      assert.equal(sessionId, 'created')
      appends.push(filePath)
      return { success: true, newMessageCount: 1 }
    },
  }
  const exclusivePlan: AutoImportTargetPlan = {
    decision: { action: 'create', reason: 'no-match' },
    concurrencyKey: 'unresolved',
    exclusive: true,
    coalesceCreate: false,
  }
  const staleStablePlan: AutoImportTargetPlan = {
    decision: { action: 'create', reason: 'no-match' },
    concurrencyKey: 'source:second',
    exclusive: false,
    coalesceCreate: true,
  }

  const results = await autoImportBatch(
    [
      { id: 'first', filePath: 'first' },
      { id: 'second', filePath: 'second' },
    ],
    deps,
    {
      concurrency: 2,
      resolveTargetPlan: async (filePath) => (filePath === 'first' ? exclusivePlan : staleStablePlan),
    }
  )

  assert.deepEqual(creates, ['first'])
  assert.deepEqual(appends, ['second'])
  assert.deepEqual(
    results.map((result) => result.status),
    ['success', 'success']
  )
})

test('re-resolves a later stable identity after an earlier automatic import writes', async () => {
  let createdSessionId: string | undefined
  const creates: string[] = []
  const appends: Array<{ sessionId: string; filePath: string }> = []
  const deps: AutoImportDeps = {
    listSessionIds: () => (createdSessionId ? [createdSessionId] : []),
    openReadonly: () => {
      throw new Error('preflight is stubbed')
    },
    sessionExists: (sessionId) => sessionId === createdSessionId,
    resolveTarget: async () =>
      createdSessionId
        ? { action: 'incremental', sessionId: createdSessionId, matchedBy: 'trailing-messages' }
        : { action: 'create', reason: 'no-match' },
    async createSession(filePath) {
      creates.push(filePath)
      createdSessionId = 'created'
      return { success: true, sessionId: createdSessionId }
    },
    async appendSession(sessionId, filePath) {
      appends.push({ sessionId, filePath })
      return { success: true, newMessageCount: 1 }
    },
  }
  const plans = new Map<string, AutoImportTargetPlan>([
    [
      'before-drift',
      {
        decision: { action: 'create', reason: 'no-match' },
        concurrencyKey: 'source:old-stable-id',
        exclusive: false,
        coalesceCreate: true,
      },
    ],
    [
      'after-drift',
      {
        decision: { action: 'create', reason: 'no-match' },
        concurrencyKey: 'source:new-stable-id',
        exclusive: false,
        coalesceCreate: true,
      },
    ],
  ])

  const results = await autoImportBatch(
    [
      { id: 'before', filePath: 'before-drift' },
      { id: 'after', filePath: 'after-drift' },
    ],
    deps,
    {
      concurrency: 2,
      resolveTargetPlan: async (filePath) => plans.get(filePath)!,
    }
  )

  assert.deepEqual(creates, ['before-drift'])
  assert.deepEqual(appends, [{ sessionId: 'created', filePath: 'after-drift' }])
  assert.deepEqual(
    results.map((result) => result.status),
    ['success', 'success']
  )
})

test('re-resolves every trailing-message match after an earlier append changes the target tail', async () => {
  let firstAppendFinished = false
  const appends: string[] = []
  const creates: string[] = []
  const deps: AutoImportDeps = {
    listSessionIds: () => ['existing'],
    openReadonly: () => {
      throw new Error('preflight is stubbed')
    },
    sessionExists: (sessionId) => sessionId === 'existing',
    resolveTarget: async () =>
      firstAppendFinished
        ? { action: 'create', reason: 'no-match' }
        : { action: 'incremental', sessionId: 'existing', matchedBy: 'trailing-messages' },
    async createSession(filePath) {
      creates.push(filePath)
      return { success: true, sessionId: 'created' }
    },
    async appendSession(_sessionId, filePath) {
      appends.push(filePath)
      firstAppendFinished = true
      return { success: true, newMessageCount: 1 }
    },
  }
  const staleTrailingPlan: AutoImportTargetPlan = {
    decision: { action: 'incremental', sessionId: 'existing', matchedBy: 'trailing-messages' },
    concurrencyKey: 'unresolved',
    exclusive: true,
    coalesceCreate: false,
  }

  const results = await autoImportBatch(
    [
      { id: 'first', filePath: 'first' },
      { id: 'second', filePath: 'second' },
    ],
    deps,
    {
      concurrency: 2,
      resolveTargetPlan: async () => staleTrailingPlan,
    }
  )

  assert.deepEqual(appends, ['first'])
  assert.deepEqual(creates, ['second'])
  assert.deepEqual(
    results.map((result) => result.status),
    ['success', 'success']
  )
})

test('invalidates a later auto-resolved incremental plan after exclusive work writes', async () => {
  let createdSessionId: string | undefined
  const appends: Array<{ sessionId: string; filePath: string }> = []
  const deps: AutoImportDeps = {
    listSessionIds: () => ['old', ...(createdSessionId ? [createdSessionId] : [])],
    openReadonly: () => {
      throw new Error('preflight is stubbed')
    },
    sessionExists: (sessionId) => sessionId === 'old' || sessionId === createdSessionId,
    resolveTarget: async () =>
      createdSessionId
        ? { action: 'incremental', sessionId: createdSessionId, matchedBy: 'trailing-messages' }
        : { action: 'create', reason: 'no-match' },
    async createSession() {
      createdSessionId = 'created'
      return { success: true, sessionId: createdSessionId }
    },
    async appendSession(sessionId, filePath) {
      appends.push({ sessionId, filePath })
      return { success: true, newMessageCount: 1 }
    },
  }
  const plans = new Map<string, AutoImportTargetPlan>([
    [
      'first',
      {
        decision: { action: 'create', reason: 'no-match' },
        concurrencyKey: 'unresolved',
        exclusive: true,
        coalesceCreate: false,
      },
    ],
    [
      'second',
      {
        decision: { action: 'incremental', sessionId: 'old', matchedBy: 'stable-id' },
        concurrencyKey: 'session:old',
        exclusive: false,
        coalesceCreate: false,
      },
    ],
  ])

  await autoImportBatch(
    [
      { id: 'first', filePath: 'first' },
      { id: 'second', filePath: 'second' },
    ],
    deps,
    {
      concurrency: 2,
      resolveTargetPlan: async (filePath) => plans.get(filePath)!,
    }
  )

  assert.deepEqual(appends, [{ sessionId: 'created', filePath: 'second' }])
})
