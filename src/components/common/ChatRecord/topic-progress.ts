import type { ChatTopicRun } from '@openchatlab/shared-types'

export type ChatTopicProgressDetail =
  | {
      key: 'records.topics.progressBlock'
      params: { current: number; total: number; seconds: number }
    }
  | {
      key: 'records.topics.progressFinalizing'
      params: { seconds: number }
    }

export function resolveChatTopicProgressDetail(
  run: Pick<
    ChatTopicRun,
    'status' | 'currentDay' | 'currentBlockIndex' | 'completedBlocks' | 'totalBlocks' | 'updatedAt'
  > | null,
  now = Date.now()
): ChatTopicProgressDetail | null {
  if (!run || run.status !== 'running' || run.currentDay === null || run.totalBlocks === 0) return null

  const seconds = Math.max(0, Math.floor((now - run.updatedAt) / 1000))
  if (run.currentBlockIndex === null) {
    return { key: 'records.topics.progressFinalizing', params: { seconds } }
  }

  return {
    key: 'records.topics.progressBlock',
    params: {
      current: Math.min(run.completedBlocks + 1, run.totalBlocks),
      total: run.totalBlocks,
      seconds,
    },
  }
}
