import assert from 'node:assert/strict'
import test from 'node:test'
import type { PushImportAnalysisOutcome, PushImportOutcome } from '@openchatlab/node-runtime'
import { createJsonPushImportHandler } from './json-push-handler'

function successfulImport(sessionId: string): PushImportOutcome {
  return {
    ok: true,
    result: {
      sessionId,
      created: true,
      batch: { receivedCount: 1, writtenCount: 1, duplicateCount: 0 },
      session: { totalCount: 1, memberCount: 1, firstTimestamp: 100, lastTimestamp: 100 },
      updates: { metaUpdated: true, membersAdded: 1, membersUpdated: 0 },
    },
  }
}

test('JSON Push handler replays successful requests without executing twice', async () => {
  let executeCount = 0
  let successCount = 0
  const handler = createJsonPushImportHandler({
    execute: async (sessionId) => {
      executeCount++
      return successfulImport(sessionId)
    },
    onSuccess: async () => {
      successCount++
    },
  })
  const request = {
    sessionId: 'session-1',
    body: { messages: [{ content: 'hello' }] },
    contentType: 'application/json',
    idempotencyKey: 'request-1',
  }

  const first = await handler(request)
  const replay = await handler(request)

  assert.equal(first.statusCode, 200)
  assert.deepEqual(replay, first)
  assert.equal(executeCount, 1)
  assert.equal(successCount, 1)
})

test('JSON Push handler supports injected Desktop dry-run analysis without firing write notifications', async () => {
  let executeCount = 0
  let successCount = 0
  const analysis: PushImportAnalysisOutcome = {
    ok: true,
    result: {
      sessionId: 'session-1',
      created: true,
      totalInFile: 3,
      newMessageCount: 2,
      duplicateCount: 1,
      newMemberCount: 4,
    },
  }
  const handler = createJsonPushImportHandler({
    execute: async (sessionId) => {
      executeCount++
      return successfulImport(sessionId)
    },
    analyze: async () => analysis,
    includeDryRunInIdempotencyKey: true,
    onSuccess: () => {
      successCount++
    },
  })

  const dryRun = await handler({
    sessionId: 'session-1',
    body: { messages: [] },
    contentType: 'application/json',
    idempotencyKey: 'request-1',
    dryRun: true,
  })
  const write = await handler({
    sessionId: 'session-1',
    body: { messages: [] },
    contentType: 'application/json',
    idempotencyKey: 'request-1',
    dryRun: false,
  })

  assert.equal(dryRun.statusCode, 200)
  assert.deepEqual(dryRun.response.success && dryRun.response.data, {
    sessionId: 'session-1',
    created: true,
    dryRun: true,
    analysis: {
      totalInFile: 3,
      newMessageCount: 2,
      duplicateCount: 1,
      newMemberCount: 4,
    },
  })
  assert.equal(write.statusCode, 200)
  assert.equal(executeCount, 1)
  assert.equal(successCount, 1)
})

test('JSON Push handler releases an idempotency key when the Desktop active-request guard rejects it', async () => {
  let allowAcquire = false
  const handler = createJsonPushImportHandler({
    execute: async (sessionId) => successfulImport(sessionId),
    importInProgressMessage: 'An import operation is already in progress',
    acquire: () => allowAcquire,
    release: () => {},
  })
  const request = {
    sessionId: 'session-1',
    body: { messages: [] },
    contentType: 'application/json',
    idempotencyKey: 'retryable-request',
  }

  const rejected = await handler(request)
  allowAcquire = true
  const retry = await handler(request)

  assert.equal(rejected.statusCode, 409)
  assert.deepEqual(rejected.response, {
    success: false,
    error: {
      code: 'IMPORT_IN_PROGRESS',
      message: 'An import operation is already in progress',
    },
  })
  assert.equal(retry.statusCode, 200)
})

test('JSON Push handler rejects unsafe session IDs before invoking the executor', async () => {
  let executed = false
  const handler = createJsonPushImportHandler({
    execute: async (sessionId) => {
      executed = true
      return successfulImport(sessionId)
    },
  })

  const result = await handler({
    sessionId: '../unsafe',
    body: {},
    contentType: 'application/json',
  })

  assert.equal(result.statusCode, 400)
  assert.equal(result.response.success, false)
  assert.equal(executed, false)
})
