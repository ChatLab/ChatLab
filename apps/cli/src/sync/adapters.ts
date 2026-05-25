/**
 * Server-side implementations of @openchatlab/sync abstractions.
 *
 * NodeFetcher: uses Node.js fetch API
 * DirectImporter: uses DatabaseManager + streamImport/importData
 * NoopNotifier: placeholder (future: SSE push)
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as crypto from 'crypto'
import type { HttpFetcher, DataImporter, SyncNotifier, ImportResult, FetchParams, SyncLogger } from '@openchatlab/sync'
import { NOOP_LOGGER } from '@openchatlab/sync'
import { buildPullUrl } from '@openchatlab/sync'
import type { DatabaseManager } from '@openchatlab/node-runtime'
import { openBetterSqliteDatabase } from '@openchatlab/node-runtime'
import { parseFile } from '../import/chatlab-reader'
import { importData } from '../import/importer'
import { resolveCliPath } from '../paths'

function getTempFilePath(ext: string): string {
  const id = crypto.randomBytes(8).toString('hex')
  return path.join(os.tmpdir(), `chatlab-pull-${id}${ext}`)
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

function resolveNativeBinding(): string | undefined {
  if (process.versions.electron) return undefined
  const nativePath = resolveCliPath('native/better_sqlite3.node')
  if (fs.existsSync(nativePath)) return nativePath
  return undefined
}

export class DirectImporter implements DataImporter {
  private dbManager: DatabaseManager
  private nativeBinding: string | undefined
  private logger: SyncLogger

  constructor(dbManager: DatabaseManager, logger?: SyncLogger) {
    this.dbManager = dbManager
    this.nativeBinding = resolveNativeBinding()
    this.logger = logger ?? NOOP_LOGGER
  }

  sessionExists(sessionId: string): boolean {
    const dbPath = this.dbManager.getDbPath(sessionId)
    if (!fs.existsSync(dbPath)) return false
    try {
      const db = openBetterSqliteDatabase(dbPath, { readonly: true, nativeBinding: this.nativeBinding })
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
    } catch {
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
      const data = await parseFile(tempFile)

      this.dbManager.close(sessionId)
      const result = await importData(this.dbManager, data, {
        sessionId,
        nativeBinding: this.nativeBinding,
      })

      if (result.success) {
        this.logger.info(
          `[DirectImporter] Incremental OK: +${result.messageCount} messages (${result.duplicateCount} duplicates skipped)`
        )
        return {
          success: true,
          newMessageCount: result.messageCount,
          sessionId,
        }
      }

      if (
        result.error?.includes('not found') ||
        result.error?.includes('session_not_found') ||
        result.error?.includes('no such table')
      ) {
        return { success: false, newMessageCount: 0, sessionId, needFullResync: true }
      }

      return { success: false, newMessageCount: 0, sessionId, error: result.error }
    } catch (err: any) {
      this.logger.error(`[DirectImporter] Incremental import failed`, err)
      return { success: false, newMessageCount: 0, sessionId, error: err.message }
    }
  }

  private async fullImportFile(tempFile: string, externalId: string): Promise<ImportResult> {
    try {
      const data = await parseFile(tempFile)

      const result = await importData(this.dbManager, data, {
        sessionId: externalId,
        nativeBinding: this.nativeBinding,
      })

      if (result.success) {
        this.logger.info(
          `[DirectImporter] Full import OK: ${result.messageCount} messages, ${result.memberCount} members`
        )
        return { success: true, newMessageCount: result.messageCount, sessionId: externalId }
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
