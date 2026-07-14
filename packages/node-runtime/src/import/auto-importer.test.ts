import assert from 'node:assert/strict'
import test from 'node:test'
import {
  analyzeAutoImportFile,
  autoImportFile,
  type AutoImportAnalysisDeps,
  type AutoImportDeps,
} from './auto-importer'
import type { AutoImportDecision } from './auto-import-matcher'

function createDeps(options?: {
  existingSessionIds?: string[]
  decision?: AutoImportDecision
  matchError?: Error
  createdSessionId?: string
  incrementalNewCount?: number
  incrementalDuplicateCount?: number
}) {
  const calls = {
    match: 0,
    create: [] as Array<{ filePath: string; sessionId?: string }>,
    append: [] as Array<{ sessionId: string; filePath: string }>,
  }
  const existing = new Set(options?.existingSessionIds ?? [])

  const deps: AutoImportDeps = {
    listSessionIds: () => [...existing],
    openReadonly: () => {
      throw new Error('not used by fake matcher')
    },
    sessionExists: (sessionId) => existing.has(sessionId),
    resolveTarget: async () => {
      calls.match++
      if (options?.matchError) throw options.matchError
      return options?.decision ?? { action: 'create', reason: 'no-match' }
    },
    createSession: async (filePath, _formatOptions, sessionId) => {
      calls.create.push({ filePath, sessionId })
      return {
        success: true,
        sessionId: sessionId ?? options?.createdSessionId ?? 'created-session',
        diagnostics: {
          logFile: null,
          detectedFormat: 'fixture',
          messagesReceived: 12,
          messagesWritten: 10,
          duplicateCount: 0,
          messagesSkipped: 2,
          skipReasons: { noSenderId: 0, noAccountName: 0, invalidTimestamp: 2, noType: 0 },
        },
      }
    },
    appendSession: async (sessionId, filePath) => {
      calls.append.push({ sessionId, filePath })
      const newMessageCount = options?.incrementalNewCount ?? 3
      return {
        success: true,
        newMessageCount,
        batch: {
          receivedCount: newMessageCount + (options?.incrementalDuplicateCount ?? 5),
          writtenCount: newMessageCount,
          duplicateCount: options?.incrementalDuplicateCount ?? 5,
          errorCount: 0,
          errorReasonCounts: {},
          errorSample: [],
        },
        session: {
          totalCount: 12,
          memberCount: 2,
          firstTimestamp: 100,
          lastTimestamp: 200,
        },
        updates: {
          metaUpdated: true,
          membersAdded: 1,
          membersUpdated: 1,
        },
      }
    },
  }

  return { deps, calls }
}

test('explicit existing session forces incremental import without matching', async () => {
  const { deps, calls } = createDeps({ existingSessionIds: ['explicit'] })

  const result = await autoImportFile('source.json', deps, { explicitSessionId: 'explicit' })

  assert.deepEqual(result, {
    success: true,
    sessionId: 'explicit',
    importMode: 'incremental',
    newMessageCount: 3,
    duplicateCount: 5,
    batch: {
      receivedCount: 8,
      writtenCount: 3,
      duplicateCount: 5,
      errorCount: 0,
      errorReasonCounts: {},
      errorSample: [],
    },
    session: {
      totalCount: 12,
      memberCount: 2,
      firstTimestamp: 100,
      lastTimestamp: 200,
    },
    updates: {
      metaUpdated: true,
      membersAdded: 1,
      membersUpdated: 1,
    },
  })
  assert.equal(calls.match, 0)
  assert.deepEqual(calls.create, [])
  assert.deepEqual(calls.append, [{ sessionId: 'explicit', filePath: 'source.json' }])
})

test('explicit missing session creates with the requested id without matching', async () => {
  const { deps, calls } = createDeps()

  const result = await autoImportFile('source.json', deps, { explicitSessionId: 'requested' })

  assert.equal(result.success, true)
  assert.equal(result.sessionId, 'requested')
  assert.equal(result.importMode, 'created')
  assert.equal(result.newMessageCount, 10)
  assert.equal(result.duplicateCount, 0)
  assert.deepEqual(result.batch, {
    receivedCount: 12,
    writtenCount: 10,
    duplicateCount: 0,
  })
  assert.equal(calls.match, 0)
  assert.deepEqual(calls.create, [{ filePath: 'source.json', sessionId: 'requested' }])
})

test('explicit session IDs reject path-like or overlong values before opening a database', async () => {
  const { deps, calls } = createDeps()

  const traversal = await autoImportFile('source.json', deps, { explicitSessionId: '../outside' })
  const overlong = await autoImportFile('source.json', deps, { explicitSessionId: 'a'.repeat(129) })

  assert.deepEqual(traversal, { success: false, error: 'sessionId contains invalid characters' })
  assert.deepEqual(overlong, { success: false, error: 'sessionId contains invalid characters' })
  assert.deepEqual(calls.create, [])
  assert.deepEqual(calls.append, [])
})

test('automatic unique match preserves incremental mode when every message is duplicate', async () => {
  const { deps, calls } = createDeps({
    decision: { action: 'incremental', sessionId: 'existing', matchedBy: 'trailing-messages' },
    incrementalNewCount: 0,
    incrementalDuplicateCount: 500,
  })

  const result = await autoImportFile('source.json', deps)

  assert.deepEqual(result, {
    success: true,
    sessionId: 'existing',
    importMode: 'incremental',
    matchedBy: 'trailing-messages',
    newMessageCount: 0,
    duplicateCount: 500,
    batch: {
      receivedCount: 500,
      writtenCount: 0,
      duplicateCount: 500,
      errorCount: 0,
      errorReasonCounts: {},
      errorSample: [],
    },
    session: {
      totalCount: 12,
      memberCount: 2,
      firstTimestamp: 100,
      lastTimestamp: 200,
    },
    updates: {
      metaUpdated: true,
      membersAdded: 1,
      membersUpdated: 1,
    },
  })
  assert.equal(calls.match, 1)
  assert.deepEqual(calls.create, [])
})

for (const reason of ['no-match', 'ambiguous'] as const) {
  test(`automatic ${reason} decision creates a new session`, async () => {
    const { deps, calls } = createDeps({ decision: { action: 'create', reason } })

    const result = await autoImportFile('source.json', deps)

    assert.equal(result.success, true)
    assert.equal(result.importMode, 'created')
    assert.equal(result.createReason, reason)
    assert.equal(calls.match, 1)
    assert.equal(calls.create.length, 1)
    assert.deepEqual(calls.append, [])
  })
}

test('matcher failure stops import instead of silently creating a session', async () => {
  const { deps, calls } = createDeps({ matchError: new Error('candidate database failed') })

  const result = await autoImportFile('source.json', deps)

  assert.equal(result.success, false)
  assert.match(result.error ?? '', /candidate database failed/)
  assert.deepEqual(calls.create, [])
  assert.deepEqual(calls.append, [])
})

function createAnalysisDeps(options?: {
  existingSessionIds?: string[]
  decision?: AutoImportDecision
  incrementalNewCount?: number
  incrementalDuplicateCount?: number
}) {
  const existing = new Set(options?.existingSessionIds ?? [])
  const calls = {
    create: [] as Array<{ filePath: string; formatOptions?: Record<string, unknown> }>,
    append: [] as Array<{ sessionId: string; filePath: string; formatOptions?: Record<string, unknown> }>,
  }
  const deps: AutoImportAnalysisDeps = {
    listSessionIds: () => [...existing],
    openReadonly: () => {
      throw new Error('not used by fake matcher')
    },
    sessionExists: (sessionId) => existing.has(sessionId),
    resolveTarget: async () => options?.decision ?? { action: 'create', reason: 'no-match' },
    analyzeCreateSession: async (filePath, formatOptions) => {
      calls.create.push({ filePath, formatOptions })
      return {
        totalMessages: 12,
        newMessageCount: 10,
        duplicateCount: 2,
        totalMembers: 3,
        meta: { name: 'Fixture', platform: 'qq', type: 'group' },
      }
    },
    analyzeAppendSession: async (sessionId, filePath, formatOptions) => {
      calls.append.push({ sessionId, filePath, formatOptions })
      return {
        totalInFile: 12,
        newMessageCount: options?.incrementalNewCount ?? 4,
        duplicateCount: options?.incrementalDuplicateCount ?? 8,
      }
    },
  }
  return { deps, calls }
}

test('dry-run analysis reuses the automatic incremental target without writing', async () => {
  const { deps, calls } = createAnalysisDeps({
    existingSessionIds: ['existing'],
    decision: { action: 'incremental', sessionId: 'existing', matchedBy: 'stable-id' },
  })

  const result = await analyzeAutoImportFile('source.json', deps, {
    formatOptions: { formatId: 'chatlab', chatIndex: 1 },
  })

  assert.deepEqual(result, {
    success: true,
    importMode: 'incremental',
    sessionId: 'existing',
    matchedBy: 'stable-id',
    totalMessageCount: 12,
    newMessageCount: 4,
    duplicateCount: 8,
  })
  assert.deepEqual(calls.create, [])
  assert.deepEqual(calls.append, [
    {
      sessionId: 'existing',
      filePath: 'source.json',
      formatOptions: { formatId: 'chatlab', chatIndex: 1 },
    },
  ])
})

test('dry-run analysis reports a new-session plan without creating a database', async () => {
  const { deps, calls } = createAnalysisDeps({ decision: { action: 'create', reason: 'ambiguous' } })

  const result = await analyzeAutoImportFile('source.json', deps)

  assert.deepEqual(result, {
    success: true,
    importMode: 'created',
    createReason: 'ambiguous',
    totalMessageCount: 12,
    newMessageCount: 10,
    duplicateCount: 2,
    totalMemberCount: 3,
    meta: { name: 'Fixture', platform: 'qq', type: 'group' },
  })
  assert.deepEqual(calls.append, [])
  assert.deepEqual(calls.create, [{ filePath: 'source.json', formatOptions: undefined }])
})

test('dry-run analysis rejects an unsafe explicit session id before parsing', async () => {
  const { deps, calls } = createAnalysisDeps()

  const result = await analyzeAutoImportFile('source.json', deps, { explicitSessionId: '../outside' })

  assert.deepEqual(result, { success: false, error: 'sessionId contains invalid characters' })
  assert.deepEqual(calls.create, [])
  assert.deepEqual(calls.append, [])
})
