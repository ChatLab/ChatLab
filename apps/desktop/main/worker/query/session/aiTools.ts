/**
 * AI tool session queries — Electron worker wrappers.
 * Core search/messages logic lives in @openchatlab/core;
 * Electron adds FTS tokenization and DB lifecycle.
 */

import { searchSegments as coreSearchSessions, getSegmentMessages as coreGetSessionMessages } from '@openchatlab/core'
import type { SegmentSearchItem, SegmentMessagesData } from '@openchatlab/core'
import { openReadonlyDatabase } from './core'
import { wrapAsDatabaseAdapter } from '../../core'
import { hasFtsIndex } from '../fts'
import { tokenizeQueryForFts } from '@openchatlab/node-runtime'

// Re-export core types under Electron-local aliases
export type { SegmentSearchItem as SessionSearchResultItem }
export type { SegmentMessagesData as SessionMessagesResult }

export function searchSegments(
  sessionId: string,
  keywords?: string[],
  timeFilter?: { startTs: number; endTs: number },
  limit: number = 20,
  previewCount: number = 5
): SegmentSearchItem[] {
  const db = openReadonlyDatabase(sessionId)
  if (!db) return []

  try {
    const adapter = wrapAsDatabaseAdapter(db)

    let ftsMatchExpression: string | undefined
    if (keywords && keywords.length > 0 && hasFtsIndex(sessionId)) {
      const match = tokenizeQueryForFts(keywords)
      if (match) ftsMatchExpression = match
    }

    return coreSearchSessions(adapter, keywords, timeFilter, limit, previewCount, ftsMatchExpression)
  } catch (error) {
    console.error('searchSegments error:', error)
    return []
  } finally {
    db.close()
  }
}

export function getSegmentMessages(
  sessionId: string,
  segmentId: number,
  limit: number = 500
): SegmentMessagesData | null {
  const db = openReadonlyDatabase(sessionId)
  if (!db) return null

  try {
    const adapter = wrapAsDatabaseAdapter(db)
    return coreGetSessionMessages(adapter, segmentId, limit)
  } catch (error) {
    console.error('getSegmentMessages error:', error)
    return null
  } finally {
    db.close()
  }
}
