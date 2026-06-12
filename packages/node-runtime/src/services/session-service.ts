/**
 * Shared session service layer.
 *
 * Provides unified session CRUD used by both CLI Web routes and Electron IPC/API.
 * All business logic (sorting, data shape, validation) lives here —
 * callers only handle protocol-specific concerns (HTTP params, IPC channels).
 */

import {
  getSessionInfo,
  getSessionMeta,
  getSummaryCount,
  getPrivateChatMemberAvatar,
  isChatSessionDb,
  buildSessionInfo,
  renameSession as coreRenameSession,
  updateSessionOwnerId as coreUpdateSessionOwnerId,
} from '@openchatlab/core'
import type { CoreSessionInfo, DatabaseAdapter, SessionOverview } from '@openchatlab/core'
import type { SessionRuntimeAdapter } from './adapters'

export interface AnalysisSessionDTO extends CoreSessionInfo {
  id: string
  dbPath: string
  memberAvatar: string | null
  aiConversationCount: number
}

/**
 * Optional hooks for platform-specific behavior.
 * Electron can provide a cached overview resolver and post-list enrichment;
 * CLI Web can omit these to use default (no-cache) behavior.
 */
export interface ListSessionsOptions {
  /**
   * Resolve overview stats for a session, optionally from cache.
   * When provided, used instead of the default `getSessionOverview` SQL query.
   * Electron worker uses this to read from JSON file cache (resolveOverview).
   */
  resolveOverview?(db: DatabaseAdapter, sessionId: string): SessionOverview

  /**
   * Enrich each session DTO after construction.
   * Electron uses this to fill aiConversationCount, etc.
   */
  enrichSession?(dto: AnalysisSessionDTO): AnalysisSessionDTO
}

function buildSession(
  db: DatabaseAdapter,
  id: string,
  dbPath: string,
  options?: ListSessionsOptions
): AnalysisSessionDTO | null {
  const meta = getSessionMeta(db)
  if (!meta) return null

  const overview = options?.resolveOverview ? options.resolveOverview(db, id) : undefined
  const info = overview ? buildSessionInfo(meta, overview, getSummaryCount(db)) : getSessionInfo(db)
  if (!info) return null

  let memberAvatar: string | null = null
  if (meta.type === 'private') {
    memberAvatar = getPrivateChatMemberAvatar(db, meta.name, meta.ownerId)
  }

  let dto: AnalysisSessionDTO = { ...info, id, dbPath, memberAvatar, aiConversationCount: 0 }
  if (options?.enrichSession) {
    dto = options.enrichSession(dto)
  }
  return dto
}

/**
 * List all valid sessions, sorted by importedAt descending.
 *
 * Accepts optional hooks so Electron can plug in cached overview resolution
 * and session enrichment without duplicating the listing logic.
 */
export function listAnalysisSessions(
  adapter: SessionRuntimeAdapter,
  options?: ListSessionsOptions
): AnalysisSessionDTO[] {
  const sessionIds = adapter.listSessionIds()
  const sessions: AnalysisSessionDTO[] = []

  for (const id of sessionIds) {
    const db = adapter.openReadonly(id)
    if (!db) continue
    if (!isChatSessionDb(db)) continue

    const dto = buildSession(db, id, adapter.getDbPath(id), options)
    if (dto) sessions.push(dto)
  }

  return sessions.sort((a, b) => b.importedAt - a.importedAt)
}

/**
 * Get a single session by ID.
 */
export function getAnalysisSession(
  adapter: SessionRuntimeAdapter,
  sessionId: string,
  options?: ListSessionsOptions
): AnalysisSessionDTO | null {
  const db = adapter.openReadonly(sessionId)
  if (!db) return null
  return buildSession(db, sessionId, adapter.getDbPath(sessionId), options)
}

/**
 * Rename a session (updates meta.name).
 */
export function renameSession(adapter: SessionRuntimeAdapter, sessionId: string, name: string): void {
  const db = adapter.ensureWritable(sessionId)
  coreRenameSession(db, name)
}

/**
 * Update session owner_id.
 */
export function updateSessionOwnerId(adapter: SessionRuntimeAdapter, sessionId: string, ownerId: string | null): void {
  const db = adapter.ensureWritable(sessionId)
  coreUpdateSessionOwnerId(db, ownerId)
}

/**
 * Delete a session (close DB + remove files/cache).
 * Returns true if deleted, false if file not found.
 */
export function deleteSession(adapter: SessionRuntimeAdapter, sessionId: string): boolean {
  return adapter.deleteSessionFile(sessionId)
}
