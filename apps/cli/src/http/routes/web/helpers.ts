/**
 * Shared helpers for web route modules.
 */

import * as fs from 'fs'
import type { TimeFilter } from '@openchatlab/shared-types'
import type { DatabaseManager } from '@openchatlab/node-runtime'
import { resolveCliPath } from '../../../paths'

export function parseTimeFilter(query: Record<string, string | undefined>): TimeFilter | undefined {
  const { startTs, endTs, memberId } = query
  if (!startTs && !endTs && !memberId) return undefined
  const filter: TimeFilter = {}
  if (startTs) filter.startTs = parseInt(startTs, 10)
  if (endTs) filter.endTs = parseInt(endTs, 10)
  if (memberId) filter.memberId = parseInt(memberId, 10)
  return filter
}

export function resolveNativeBinding(): string | undefined {
  if (process.versions.electron) return undefined
  const nativePath = resolveCliPath('native/better_sqlite3.node')
  if (fs.existsSync(nativePath)) return nativePath
  return undefined
}

export function getAiDataDir(dbManager: DatabaseManager): string {
  const pathProvider = (dbManager as any)['pathProvider']
  if (!pathProvider) {
    throw Object.assign(new Error('PathProvider not available'), { statusCode: 500 })
  }
  return pathProvider.getAiDataDir()
}

export function ensureDb(dbManager: DatabaseManager, sessionId: string) {
  const db = dbManager.open(sessionId)
  if (!db) {
    throw Object.assign(new Error(`Session not found: ${sessionId}`), { statusCode: 404 })
  }
  return db
}
