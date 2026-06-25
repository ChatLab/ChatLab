import assert from 'node:assert/strict'
import test from 'node:test'
import type { DataSource } from './apiServer'
import { createSyncResultPoller } from './syncResultPolling'

function createDataSource(overrides: Partial<DataSource['sessions'][number]> = {}): DataSource {
  return {
    id: 'source-1',
    name: 'Source',
    baseUrl: 'https://example.com',
    token: '',
    intervalMinutes: 60,
    pullLimit: 1000,
    enabled: true,
    createdAt: 1,
    sessions: [
      {
        id: 'subscription-1',
        name: 'Chat',
        remoteSessionId: 'remote-1',
        targetSessionId: '',
        lastPullAt: 0,
        lastStatus: 'idle',
        lastError: '',
        lastNewMessages: 0,
        ...overrides,
      },
    ],
  }
}

test('Web 自动同步状态变化后通知刷新会话列表', async () => {
  const timer = { tick: null as (() => void) | null }
  let sources = [createDataSource()]
  let completedCount = 0

  const stop = createSyncResultPoller({
    loadDataSources: async () => sources,
    onResult: () => {
      completedCount++
    },
    schedule: (callback) => {
      timer.tick = callback
      return 1
    },
    cancelSchedule: () => {},
  })

  await Promise.resolve()
  assert.equal(completedCount, 0)

  sources = [
    createDataSource({
      targetSessionId: 'local-1',
      lastPullAt: 100,
      lastStatus: 'success',
      lastNewMessages: 12,
    }),
  ]
  timer.tick?.()
  await Promise.resolve()
  await Promise.resolve()

  assert.equal(completedCount, 1)
  stop()
})

test('轮询只把首次读取作为基线，不将已有同步结果重复通知', async () => {
  const timer = { tick: null as (() => void) | null }
  const sources = [
    createDataSource({
      targetSessionId: 'local-1',
      lastPullAt: 100,
      lastStatus: 'success',
      lastNewMessages: 12,
    }),
  ]
  let completedCount = 0

  const stop = createSyncResultPoller({
    loadDataSources: async () => sources,
    onResult: () => {
      completedCount++
    },
    schedule: (callback) => {
      timer.tick = callback
      return 1
    },
    cancelSchedule: () => {},
  })

  await Promise.resolve()
  timer.tick?.()
  await Promise.resolve()
  await Promise.resolve()

  assert.equal(completedCount, 0)
  stop()
})
