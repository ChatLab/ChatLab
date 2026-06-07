/**
 * Electron-specific implementations of @openchatlab/sync abstractions.
 *
 * ElectronFetcher: uses electron.net.request
 * WorkerImporter: uses worker thread IPC (streamImport / incrementalImport)
 * BrowserWindowNotifier: uses BrowserWindow.webContents.send
 */

import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import Database from 'better-sqlite3'
import { net, BrowserWindow, app } from 'electron'
import { getTempDir } from '../paths'
import * as worker from '../worker/workerManager'
import { getPathProvider } from '../path-context'
import { assertDesktopDataDirCompatible, getDesktopAppVersion } from '../runtime-compat'
import type { HttpFetcher, DataImporter, SyncNotifier, ImportResult, FetchParams, SyncLogger } from '@openchatlab/sync'
import { buildPullUrl, NOOP_LOGGER } from '@openchatlab/sync'

function getTempFilePath(ext: string): string {
  const id = crypto.randomBytes(8).toString('hex')
  return path.join(getTempDir(), `pull-import-${id}${ext}`)
}

// ==================== ElectronFetcher ====================

export class ElectronFetcher implements HttpFetcher {
  fetchToTempFile(baseUrl: string, remoteSessionId: string, token: string, params: FetchParams): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const url = buildPullUrl(baseUrl, remoteSessionId, params)
      const request = net.request(url)

      if (token) request.setHeader('Authorization', `Bearer ${token}`)
      request.setHeader('Accept', 'application/json')

      let tempFile = ''
      let writeStream: fs.WriteStream | null = null

      request.on('response', (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`))
          return
        }

        const contentType = (response.headers['content-type'] as string) || 'application/json'
        const isJsonl = contentType.includes('ndjson') || contentType.includes('jsonl')
        tempFile = getTempFilePath(isJsonl ? '.jsonl' : '.json')
        writeStream = fs.createWriteStream(tempFile)

        response.on('data', (chunk: Buffer) => writeStream!.write(chunk))
        response.on('end', () => writeStream!.end(() => resolve(tempFile)))
        response.on('error', (err: Error) => {
          writeStream?.end()
          cleanupTempFile(tempFile)
          reject(err)
        })
      })

      request.on('error', (err: Error) => {
        if (writeStream) writeStream.end()
        if (tempFile) cleanupTempFile(tempFile)
        reject(err)
      })

      request.end()
    })
  }
}

function cleanupTempFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  } catch {
    /* ignore */
  }
}

// ==================== WorkerImporter ====================

export class WorkerImporter implements DataImporter {
  private logger: SyncLogger

  constructor(logger?: SyncLogger) {
    this.logger = logger ?? NOOP_LOGGER
  }

  sessionExists(sessionId: string): boolean {
    assertDesktopDataDirCompatible(getPathProvider(), getDesktopAppVersion(app.getVersion()))

    const dbPath = path.join(worker.getDbDirectory(), `${sessionId}.db`)
    if (!fs.existsSync(dbPath)) return false
    try {
      const db = new Database(dbPath, { readonly: true })
      const row = db
        .prepare("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='message'")
        .get() as { cnt: number }
      db.close()
      if (row.cnt === 0) {
        this.logger.warn(`[Pull] DB file exists but has no message table: ${sessionId}, removing`)
        try {
          fs.unlinkSync(dbPath)
        } catch {
          /* ignore */
        }
        return false
      }
      return true
    } catch {
      this.logger.warn(`[Pull] Cannot validate DB file: ${sessionId}, removing`)
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
    return this.fullImportFile(tempFile, externalId)
  }

  private async incrementalImportFile(sessionId: string, tempFile: string): Promise<ImportResult> {
    this.logger.info(`[Pull] Incremental import to session ${sessionId}`)
    const result = await worker.incrementalImport(sessionId, tempFile)
    if (result.success) {
      this.logger.info(`[Pull] Incremental OK: +${result.newMessageCount} messages`)
      try {
        await worker.generateIncrementalSessions(sessionId)
      } catch {
        /* ignore */
      }
      return { success: true, newMessageCount: result.newMessageCount, sessionId }
    }
    if (result.error === 'error.session_not_found' || result.error?.includes('no such table')) {
      this.logger.warn(`[Pull] Session ${sessionId} not found or schema invalid, need full resync`)
      return { success: false, newMessageCount: 0, sessionId, needFullResync: true }
    }
    this.logger.error(`[Pull] Incremental import failed: ${result.error}`)
    return { success: false, newMessageCount: 0, sessionId, error: result.error }
  }

  private async fullImportFile(tempFile: string, externalId: string): Promise<ImportResult> {
    this.logger.info(`[Pull] First import via streamImport (externalId=${externalId})`)
    const result = await worker.streamImport(tempFile, undefined, undefined, externalId)
    if (result.success) {
      const msgCount = result.diagnostics?.messagesWritten ?? 0
      this.logger.info(`[Pull] streamImport OK: session=${result.sessionId}, messages=${msgCount}`)
      return { success: true, newMessageCount: msgCount, sessionId: result.sessionId }
    }
    this.logger.error(`[Pull] streamImport failed: ${result.error}`)
    return { success: false, newMessageCount: 0, error: result.error }
  }
}

// ==================== BrowserWindowNotifier ====================

export class BrowserWindowNotifier implements SyncNotifier {
  onSessionListChanged(): void {
    try {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('api:importCompleted')
      }
    } catch {
      /* ignore */
    }
  }

  onPullResult(sourceId: string, sessionId: string | undefined, status: 'success' | 'error', detail: string): void {
    try {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('api:pullResult', { sourceId, sessionId, status, detail })
      }
    } catch {
      /* ignore */
    }
  }
}
