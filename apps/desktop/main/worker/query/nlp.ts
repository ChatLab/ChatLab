/**
 * NLP 查询模块
 *
 * Electron Worker 的 NLP 入口。
 * 负责从 worker DB 池获取数据库实例，实际计算委托给 @openchatlab/node-runtime。
 */

import { openDatabaseAdapter } from '../core'
import { computeWordFrequency } from '@openchatlab/node-runtime'
import type { WordFrequencyResult, WordFrequencyParams } from '@openchatlab/core'

export function getWordFrequency(params: WordFrequencyParams): WordFrequencyResult {
  const db = openDatabaseAdapter(params.sessionId)
  if (!db) {
    return { words: [], totalWords: 0, totalMessages: 0, uniqueWords: 0 }
  }
  return computeWordFrequency(db, params)
}
