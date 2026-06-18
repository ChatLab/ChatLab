/**
 * AI tool session queries — Electron worker wrappers.
 * Core search/messages logic lives in @openchatlab/core;
 * Electron adds FTS tokenization and DB lifecycle.
 */

import { getSegmentMessages as coreGetSessionMessages } from '@openchatlab/core'
import type { SegmentMessagesData } from '@openchatlab/core'
import { openReadonlyDatabase } from './core'
import { wrapAsDatabaseAdapter } from '../../core'

// Re-export core types under Electron-local aliases
export type { SegmentMessagesData as SessionMessagesResult }

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
