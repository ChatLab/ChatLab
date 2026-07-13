import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getWorkerRequestTimeoutMs, isRestartableReadOnlyRequestType } from './workerTimeoutPolicy'

describe('worker timeout policy', () => {
  it('allows timed-out read-only AI/debug requests to restart the worker', () => {
    assert.equal(isRestartableReadOnlyRequestType('pluginQuery'), true)
    assert.equal(isRestartableReadOnlyRequestType('executeRawSQL'), true)
    assert.equal(isRestartableReadOnlyRequestType('getSchema'), true)
    assert.equal(isRestartableReadOnlyRequestType('getChatOverview'), true)
    assert.equal(isRestartableReadOnlyRequestType('searchMessages'), true)
    assert.equal(isRestartableReadOnlyRequestType('getSegmentSummaries'), true)
  })

  it('keeps mutating, indexing, import, export, and unknown requests non-restartable', () => {
    assert.equal(isRestartableReadOnlyRequestType('generateSessions'), false)
    assert.equal(isRestartableReadOnlyRequestType('generateIncrementalSessions'), false)
    assert.equal(isRestartableReadOnlyRequestType('clearSessions'), false)
    assert.equal(isRestartableReadOnlyRequestType('updateMemberAliases'), false)
    assert.equal(isRestartableReadOnlyRequestType('mergeMembers'), false)
    assert.equal(isRestartableReadOnlyRequestType('deleteMember'), false)
    assert.equal(isRestartableReadOnlyRequestType('streamImport'), false)
    assert.equal(isRestartableReadOnlyRequestType('autoImport'), false)
    assert.equal(isRestartableReadOnlyRequestType('pushImport'), false)
    assert.equal(isRestartableReadOnlyRequestType('incrementalImport'), false)
    assert.equal(isRestartableReadOnlyRequestType('exportFilterResultToFile'), false)
    assert.equal(isRestartableReadOnlyRequestType('unknownFutureWorkerRequest'), false)
  })

  it('gives push imports the long-running worker timeout', () => {
    assert.equal(getWorkerRequestTimeoutMs('pushImport'), 10 * 60 * 1000)
    assert.equal(getWorkerRequestTimeoutMs('getSession'), 60 * 1000)
  })
})
