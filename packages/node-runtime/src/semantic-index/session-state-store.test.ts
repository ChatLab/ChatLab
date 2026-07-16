import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { SemanticIndexStateStore } from './session-state-store'

function makeTempDbPath(): string {
  const baseDir = process.env.CHATLAB_TEST_TMPDIR ?? (fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir())
  const dir = fs.mkdtempSync(path.join(baseDir, 'chatlab-sis-'))
  return path.join(dir, 'embedding_index.db')
}

const ENABLE = {
  dbPathHash: 'dbA',
  dbPath: '/data/a.db',
  modelId: 'qwen3',
  chunkerVersion: 'v1.1',
  chunkerConfigHash: 'cfg',
}

test('enable creates an enabled idle state', () => {
  const store = new SemanticIndexStateStore(makeTempDbPath())
  store.enable(ENABLE)
  const state = store.getState('dbA')!
  assert.equal(state.enabled, true)
  assert.equal(state.modelId, 'qwen3')
  assert.equal(state.indexStatus, 'idle')
  assert.equal(state.cleanupStatus, 'none')
  assert.ok(state.enabledAt && state.enabledAt > 0)
  store.close()
})

test('getState returns null for unknown conversation', () => {
  const store = new SemanticIndexStateStore(makeTempDbPath())
  assert.equal(store.getState('missing'), null)
  store.close()
})

test('disable marks not enabled and cleanup pending without deleting state', () => {
  const store = new SemanticIndexStateStore(makeTempDbPath())
  store.enable(ENABLE)
  store.disable('dbA')
  const state = store.getState('dbA')!
  assert.equal(state.enabled, false)
  assert.equal(state.cleanupStatus, 'pending')
  store.close()
})

test('re-enable clears pending cleanup', () => {
  const store = new SemanticIndexStateStore(makeTempDbPath())
  store.enable(ENABLE)
  store.disable('dbA')
  store.enable(ENABLE)
  const state = store.getState('dbA')!
  assert.equal(state.enabled, true)
  assert.equal(state.cleanupStatus, 'none')
  store.close()
})

test('enable with a different model updates model id (rebuild scenario)', () => {
  const store = new SemanticIndexStateStore(makeTempDbPath())
  store.enable(ENABLE)
  store.enable({ ...ENABLE, modelId: 'modelB' })
  assert.equal(store.getState('dbA')!.modelId, 'modelB')
  store.close()
})

test('updateProgress patches counters and index status', () => {
  const store = new SemanticIndexStateStore(makeTempDbPath())
  store.enable(ENABLE)
  store.updateProgress('dbA', {
    indexStatus: 'running',
    totalMessages: 1000,
    indexedMessages: 250,
    lastIndexedMessageId: 250,
    chunkCount: 40,
  })
  const state = store.getState('dbA')!
  assert.equal(state.indexStatus, 'running')
  assert.equal(state.totalMessages, 1000)
  assert.equal(state.indexedMessages, 250)
  assert.equal(state.lastIndexedMessageId, 250)
  assert.equal(state.chunkCount, 40)
  store.close()
})

test('setIndexStatus records failure with error message', () => {
  const store = new SemanticIndexStateStore(makeTempDbPath())
  store.enable(ENABLE)
  store.setIndexStatus('dbA', 'failed', 'disk full')
  const state = store.getState('dbA')!
  assert.equal(state.indexStatus, 'failed')
  assert.equal(state.error, 'disk full')
  store.close()
})

test('listEnabled and listPendingCleanup filter correctly', () => {
  const store = new SemanticIndexStateStore(makeTempDbPath())
  store.enable({ dbPathHash: 'a', dbPath: '/a.db', modelId: 'qwen3', chunkerVersion: 'v1.1', chunkerConfigHash: 'cfg' })
  store.enable({ dbPathHash: 'b', dbPath: '/b.db', modelId: 'qwen3', chunkerVersion: 'v1.1', chunkerConfigHash: 'cfg' })
  store.disable('b')

  assert.deepEqual(
    store.listEnabled().map((s) => s.dbPathHash),
    ['a']
  )
  assert.deepEqual(
    store.listPendingCleanup().map((s) => s.dbPathHash),
    ['b']
  )
  store.close()
})

test('setCleanupStatus and remove manage cleanup lifecycle', () => {
  const store = new SemanticIndexStateStore(makeTempDbPath())
  store.enable(ENABLE)
  store.disable('dbA')
  store.setCleanupStatus('dbA', 'running')
  assert.equal(store.getState('dbA')!.cleanupStatus, 'running')
  store.remove('dbA')
  assert.equal(store.getState('dbA'), null)
  store.close()
})

test('state persists across reopen', () => {
  const dbPath = makeTempDbPath()
  const store = new SemanticIndexStateStore(dbPath)
  store.enable(ENABLE)
  store.updateProgress('dbA', { indexedMessages: 5 })
  store.close()

  const reopened = new SemanticIndexStateStore(dbPath)
  const state = reopened.getState('dbA')!
  assert.equal(state.enabled, true)
  assert.equal(state.indexedMessages, 5)
  reopened.close()
})
