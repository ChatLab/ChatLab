/**
 * DatabaseManager adapter for the shared service layer.
 *
 * Bridges DatabaseManager's connection lifecycle to the SessionRuntimeAdapter
 * interface expected by session/member services.
 */

import * as fs from 'fs'
import type { DatabaseAdapter } from '@openchatlab/core'
import type { DatabaseManager } from '../../database-manager'
import type { SessionRuntimeAdapter } from './types'

export function createDatabaseManagerAdapter(dbManager: DatabaseManager): SessionRuntimeAdapter {
  return {
    listSessionIds: () => dbManager.listSessionIds(),
    openReadonly: (sessionId) => dbManager.open(sessionId),
    openWritable: (sessionId) => dbManager.openWritable(sessionId),
    closeSession: (sessionId) => dbManager.close(sessionId),
    getDbPath: (sessionId) => dbManager.getDbPath(sessionId),

    deleteSessionFile(sessionId: string): boolean {
      dbManager.close(sessionId)
      const dbPath = dbManager.getDbPath(sessionId)
      if (!fs.existsSync(dbPath)) return false
      fs.unlinkSync(dbPath)
      return true
    },

    ensureReadonly(sessionId: string): DatabaseAdapter {
      const db = dbManager.open(sessionId)
      if (!db) {
        throw Object.assign(new Error(`Session not found: ${sessionId}`), { statusCode: 404 })
      }
      return db
    },

    ensureWritable(sessionId: string): DatabaseAdapter {
      const db = dbManager.openWritable(sessionId)
      if (!db) {
        throw Object.assign(new Error(`Session not found: ${sessionId}`), { statusCode: 404 })
      }
      return db
    },
  }
}
