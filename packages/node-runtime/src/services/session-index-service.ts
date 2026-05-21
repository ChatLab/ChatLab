/**
 * Shared session index service.
 *
 * Wraps core's session index operations with proper writable DB handling.
 */

import {
  generateSessionIndex as coreGenerateSessionIndex,
  clearSessionIndex as coreClearSessionIndex,
} from '@openchatlab/core'
import { hasFtsTable, searchByFts, rebuildFtsIndex } from '../fts'
import type { SessionRuntimeAdapter } from './adapters'

export function generateIndex(adapter: SessionRuntimeAdapter, sessionId: string, gapThreshold: number = 1800): number {
  const db = adapter.ensureWritable(sessionId)
  return coreGenerateSessionIndex(db, gapThreshold)
}

export function clearIndex(adapter: SessionRuntimeAdapter, sessionId: string): void {
  const db = adapter.ensureWritable(sessionId)
  coreClearSessionIndex(db)
}

export function getFtsStatus(adapter: SessionRuntimeAdapter, sessionId: string): boolean {
  const db = adapter.ensureReadonly(sessionId)
  return hasFtsTable(db)
}

export function searchFts(
  adapter: SessionRuntimeAdapter,
  sessionId: string,
  keywords: string[],
  limit: number,
  offset: number
) {
  const db = adapter.ensureReadonly(sessionId)
  return searchByFts(db, keywords, limit, offset)
}

export function rebuildFts(adapter: SessionRuntimeAdapter, sessionId: string) {
  const db = adapter.ensureWritable(sessionId)
  return rebuildFtsIndex(db)
}
