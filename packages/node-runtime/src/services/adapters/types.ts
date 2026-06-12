/**
 * Adapter interfaces for the shared service layer.
 *
 * Services depend on these interfaces instead of concrete DatabaseManager or
 * Electron worker implementations — making them reusable across CLI Web and Electron.
 */

import type { DatabaseAdapter } from '@openchatlab/core'

export interface SessionRuntimeAdapter {
  listSessionIds(): string[]
  openReadonly(sessionId: string): DatabaseAdapter | null
  openWritable(sessionId: string): DatabaseAdapter | null
  closeSession(sessionId: string): void
  getDbPath(sessionId: string): string

  /** Delete the session database files and cache. Returns false if not found. */
  deleteSessionFile(sessionId: string): boolean

  /** Open readonly, throw 404 if not found. */
  ensureReadonly(sessionId: string): DatabaseAdapter

  /** Open writable (with auto-migration), throw 404 if not found. */
  ensureWritable(sessionId: string): DatabaseAdapter
}
