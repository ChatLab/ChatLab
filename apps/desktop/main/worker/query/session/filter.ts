/**
 * Filter module — thin adapter over @openchatlab/core filter algorithms.
 * Opens/closes the DB and delegates to core.
 */

import { BetterSqliteAdapter } from '@openchatlab/node-runtime'
import { openReadonlyDatabase } from './core'
import type { FilterResultWithPagination } from '@openchatlab/core'
import {
  filterMessagesWithContext as filterCore,
  getMultipleSessionsMessages as getMultiSessionsCore,
} from '@openchatlab/core'

export type { FilterMessage, ContextBlock, FilterResultWithPagination } from '@openchatlab/core'

const EMPTY_RESULT = (page: number, pageSize: number): FilterResultWithPagination => ({
  blocks: [],
  stats: { totalMessages: 0, hitMessages: 0, totalChars: 0 },
  pagination: { page, pageSize, totalBlocks: 0, totalHits: 0, hasMore: false },
})

export function filterMessagesWithContext(
  sessionId: string,
  keywords?: string[],
  timeFilter?: { startTs: number; endTs: number },
  senderIds?: number[],
  contextSize: number = 10,
  page: number = 1,
  pageSize: number = 50
): FilterResultWithPagination {
  const rawDb = openReadonlyDatabase(sessionId)
  if (!rawDb) return EMPTY_RESULT(page, pageSize)

  const db = new BetterSqliteAdapter(rawDb)
  try {
    return filterCore(db, { keywords, timeFilter, senderIds, contextSize, page, pageSize })
  } catch (error) {
    console.error('filterMessagesWithContext error:', error)
    return EMPTY_RESULT(page, pageSize)
  } finally {
    db.close()
  }
}

export function getMultipleSessionsMessages(
  sessionId: string,
  segmentIds: number[],
  page: number = 1,
  pageSize: number = 50
): FilterResultWithPagination {
  const rawDb = openReadonlyDatabase(sessionId)
  if (!rawDb) return EMPTY_RESULT(page, pageSize)

  const db = new BetterSqliteAdapter(rawDb)
  try {
    return getMultiSessionsCore(db, segmentIds, page, pageSize)
  } catch (error) {
    console.error('getMultipleSessionsMessages error:', error)
    return EMPTY_RESULT(page, pageSize)
  } finally {
    db.close()
  }
}
