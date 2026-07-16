/**
 * Server-side implementations of @openchatlab/sync abstractions.
 *
 * NodeFetcher: uses Node.js fetch API
 * DirectImporter: uses DatabaseManager + streamImport/incrementalImport
 * NoopNotifier: placeholder (future: SSE push)
 */

import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import type { HttpFetcher, DataImporter, SyncNotifier, ImportResult, FetchParams, SyncLogger } from '@openchatlab/sync'
import { NOOP_LOGGER } from '@openchatlab/sync'
import { buildPullUrl } from '@openchatlab/sync'
import type { DatabaseManager } from '@openchatlab/node-runtime'
import {
  DataDirCompatibilityError,
  getChatLabTempScopeDir,
  IMPORT_IN_PROGRESS_ERROR_KEY,
} from '@openchatlab/node-runtime'
import { streamImport, incrementalImport } from '../import/stream-import'

function getTempFilePath(ext: string): string {
  const id = crypto.randomBytes(8).toString('hex')
  return path.join(getChatLabTempScopeDir('sync'), `pull-${id}${ext}`)
}

// ==================== NodeFetcher ====================

export class NodeFetcher implements HttpFetcher {
  async fetchToTempFile(baseUrl: string, remoteSessionId: string, token: string, params: FetchParams): Promise<string> {
    const url = buildPullUrl(baseUrl, remoteSessionId, params)
    const headers: Record<string, string> = {
      Accept: 'application/json',
    }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const response = await fetch(url, { headers, signal: AbortSignal.timeout(120_000) })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const contentType = response.headers.get('content-type') || 'application/json'
    const isJsonl = contentType.includes('ndjson') || contentType.includes('jsonl')
    const tempFile = getTempFilePath(isJsonl ? '.jsonl' : '.json')

    const buffer = Buffer.from(await response.arrayBuffer())
    fs.writeFileSync(tempFile, buffer)
    return tempFile
  }
}

// ==================== DirectImporter ====================

export class DirectImporter implements DataImporter {
  private dbManager: DatabaseManager
  private logger: SyncLogger

  constructor(dbManager: DatabaseManager, logger?: SyncLogger) {
    this.dbManager = dbManager
    this.logger = logger ?? NOOP_LOGGER
  }

  sessionExists(sessionId: string): boolean {
    const dbPath = this.dbManager.getDbPath(sessionId)
    if (!fs.existsSync(dbPath)) return false
    try {
      const db = this.dbManager.openRawSessionDatabase(sessionId, { readonly: true })
      const row = db
        .prepare("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='message'")
        .get() as { cnt: number }
      db.close()
      if (row.cnt === 0) {
        this.logger.warn(`[DirectImporter] DB file exists but has no message table: ${sessionId}, removing`)
        try {
          fs.unlinkSync(dbPath)
        } catch {
          /* ignore */
        }
        return false
      }
      return true
    } catch (error) {
      if (error instanceof DataDirCompatibilityError) throw error

      this.logger.warn(`[DirectImporter] Cannot validate DB file: ${sessionId}, removing`)
      try {
        fs.unlinkSync(dbPath)
      } catch {
        /* ignore */
      }
      return false
    }
  }

  async importFile(tempFile: string, targetSessionId: string | undefined, externalId: string): Promise<ImportResult> {
    if (targetSessionId && this.sessionExists(targetSessionId)) {
      return this.incrementalImportFile(targetSessionId, tempFile)
    }

    if (targetSessionId) {
      this.logger.info(`[DirectImporter] Session ${targetSessionId} not found locally, need full resync`)
      return { success: false, newMessageCount: 0, needFullResync: true }
    }

    return this.fullImportFile(tempFile, externalId)
  }

  private async incrementalImportFile(sessionId: string, tempFile: string): Promise<ImportResult> {
    try {
      this.dbManager.close(sessionId)
      const result = await incrementalImport(this.dbManager, sessionId, tempFile)

      if (result.success) {
        const newMessageCount = result.newMessageCount
        const duplicateCount = result.batch?.duplicateCount ?? 0
        this.logger.info(
          `[DirectImporter] Incremental OK: +${newMessageCount} messages (${duplicateCount} duplicates skipped)`
        )
        return { success: true, newMessageCount, sessionId }
      }

      if (result.error === 'error.session_not_found' || result.error?.includes('no such table')) {
        return { success: false, newMessageCount: 0, sessionId, needFullResync: true }
      }
      if (result.error === IMPORT_IN_PROGRESS_ERROR_KEY) {
        this.logger.info(`[DirectImporter] Incremental import deferred: another import is in progress`)
        return { success: false, newMessageCount: 0, sessionId, error: result.error, retryable: true }
      }

      return { success: false, newMessageCount: 0, sessionId, error: result.error }
    } catch (err: any) {
      this.logger.error(`[DirectImporter] Incremental import failed`, err)
      return { success: false, newMessageCount: 0, sessionId, error: err.message }
    }
  }

  private async fullImportFile(tempFile: string, externalId: string): Promise<ImportResult> {
    try {
      const result = await streamImport(this.dbManager, tempFile, { sessionId: externalId })

      if (result.success) {
        const newMessageCount = result.diagnostics?.messagesWritten ?? 0
        this.logger.info(`[DirectImporter] Full import OK: +${newMessageCount} messages`)
        return { success: true, newMessageCount, sessionId: result.sessionId ?? externalId }
      }
      if (result.error === IMPORT_IN_PROGRESS_ERROR_KEY) {
        this.logger.info(`[DirectImporter] Full import deferred: another import is in progress`)
        return { success: false, newMessageCount: 0, error: result.error, retryable: true }
      }

      return { success: false, newMessageCount: 0, error: result.error }
    } catch (err: any) {
      this.logger.error(`[DirectImporter] Full import failed`, err)
      return { success: false, newMessageCount: 0, error: err.message }
    }
  }
}

// ==================== NoopNotifier ====================

const noop = () => {}

export class NoopNotifier implements SyncNotifier {
  onSessionListChanged = noop
  onPullResult = noop
}
