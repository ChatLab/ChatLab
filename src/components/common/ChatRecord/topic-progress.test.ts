import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveChatTopicProgressDetail } from './topic-progress'

test('reports run-wide block progress after advancing to a later day', () => {
  assert.deepEqual(
    resolveChatTopicProgressDetail(
      {
        status: 'running',
        currentDay: '2026-08-10',
        currentBlockIndex: 0,
        completedBlocks: 2,
        totalBlocks: 4,
        updatedAt: 10_000,
      },
      13_000
    ),
    {
      key: 'records.topics.progressBlock',
      params: { current: 3, total: 4, seconds: 3 },
    }
  )
})

test('reports daily finalization after all blocks for the current day finish', () => {
  assert.deepEqual(
    resolveChatTopicProgressDetail(
      {
        status: 'running',
        currentDay: '2026-08-10',
        currentBlockIndex: null,
        completedBlocks: 2,
        totalBlocks: 4,
        updatedAt: 10_000,
      },
      13_000
    ),
    {
      key: 'records.topics.progressFinalizing',
      params: { seconds: 3 },
    }
  )
})
