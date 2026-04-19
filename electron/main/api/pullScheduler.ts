/**
 * ChatLab API — Pull scheduler (hierarchical data source model)
 * One timer per DataSource; each tick pulls all ImportSessions under it.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { net, BrowserWindow } from 'electron'
import { getTempDir } from '../paths'
import * as worker from '../worker/workerManager'
import {
  loadDataSources,
  type DataSource,
  type ImportSession,
  updateImportSession,
} from './dataSource'
import { getImportingStatus } from './routes/import'
import { apiLogger } from './logger'

const timers = new Map<string, ReturnType<typeof setInterval>>()
let initialized = false

// ==================== Helpers ====================

function getTempFilePath(ext: string): string {
  const id = crypto.randomBytes(8).toString('hex')
  return path.join(getTempDir(), `pull-import-${id}${ext}`)
}

function cleanupTempFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  } catch {
    /* ignore */
  }
}

function notifySessionListChanged(): void {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('api:importCompleted')
    }
  } catch {
    /* ignore */
  }
}

function notifyPullResult(
  sourceId: string,
  sessionId: string | undefined,
  status: 'success' | 'error',
  detail: string
): void {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('api:pullResult', { sourceId, sessionId, status, detail })
    }
  } catch {
    /* ignore */
  }
}

// ==================== Sync block ====================

interface SyncMeta {
  hasMore: boolean
  nextSince?: number
  nextOffset?: number
  watermark?: number
}

function parseSyncFromFile(filePath: string): SyncMeta | null {
  try {
    const isJsonl = filePath.endsWith('.jsonl')
    if (isJsonl) {
      const content = fs.readFileSync(filePath, 'utf-8')
      const lines = content.trimEnd().split('\n')
      for (let i = lines.length - 1; i >= Math.max(0, lines.length - 5); i--) {
        try {
          const obj = JSON.parse(lines[i])
          if (obj._type === 'sync') {
            return { hasMore: !!obj.hasMore, nextSince: obj.nextSince, nextOffset: obj.nextOffset, watermark: obj.watermark }
          }
        } catch {
          continue
        }
      }
      return null
    }

    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed.sync && typeof parsed.sync === 'object') {
      const s = parsed.sync
      return { hasMore: !!s.hasMore, nextSince: s.nextSince, nextOffset: s.nextOffset, watermark: s.watermark }
    }
    return null
  } catch {
    return null
  }
}

// ==================== Fetch ====================

interface FetchParams {
  since?: number
  offset?: number
  end?: number
  limit?: number
}

function buildPullUrl(baseUrl: string, remoteSessionId: string, params: FetchParams): string {
  const base = `${baseUrl}/sessions/${remoteSessionId}/messages`
  const qs: string[] = ['format=chatlab']
  if (params.since !== undefined && params.since > 0) qs.push(`since=${params.since}`)
  if (params.offset !== undefined && params.offset > 0) qs.push(`offset=${params.offset}`)
  if (params.end !== undefined && params.end > 0) qs.push(`end=${params.end}`)
  if (params.limit !== undefined && params.limit > 0) qs.push(`limit=${params.limit}`)

  return base + '?' + qs.join('&')
}

async function fetchToTempFile(
  baseUrl: string,
  remoteSessionId: string,
  token: string,
  params: FetchParams
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const url = buildPullUrl(baseUrl, remoteSessionId, params)
    const request = net.request(url)

    if (token) request.setHeader('Authorization', `Bearer ${token}`)
    request.setHeader('Accept', 'application/json, application/x-ndjson')

    const contentType = { value: '' }
    let tempFile = ''
    let writeStream: fs.WriteStream | null = null

    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`))
        return
      }

      contentType.value = (response.headers['content-type'] as string) || 'application/json'
      const isJsonl = contentType.value.includes('ndjson') || contentType.value.includes('jsonl')
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

// ==================== Import helper ====================

function deriveLocalSessionId(baseUrl: string, remoteSessionId: string): string {
  const hash = crypto.createHash('sha256').update(`${baseUrl}\0${remoteSessionId}`).digest('hex').slice(0, 12)
  return `remote_${hash}`
}

function localSessionExists(sessionId: string): boolean {
  const dbPath = path.join(worker.getDbDirectory(), `${sessionId}.db`)
  return fs.existsSync(dbPath)
}

interface ImportResult {
  success: boolean
  newMessageCount: number
  sessionId?: string
  error?: string
  needFullResync?: boolean
}

async function importTempFile(
  baseUrl: string,
  sess: ImportSession,
  tempFile: string
): Promise<ImportResult> {
  let targetId = sess.targetSessionId
  if (!targetId) {
    const derived = deriveLocalSessionId(baseUrl, sess.remoteSessionId)
    if (localSessionExists(derived)) {
      targetId = derived
      apiLogger.info(`[Pull] Reusing existing local session ${derived} for "${sess.name}"`)
    }
  }

  if (targetId) {
    apiLogger.info(`[Pull] Incremental import to session ${targetId}`)
    const result = await worker.incrementalImport(targetId, tempFile)
    if (result.success) {
      apiLogger.info(`[Pull] Incremental OK: +${result.newMessageCount} messages`)
      try {
        await worker.generateIncrementalSessions(targetId)
      } catch {
        /* ignore */
      }
      return { success: true, newMessageCount: result.newMessageCount, sessionId: targetId }
    }
    if (result.error === 'error.session_not_found') {
      apiLogger.warn(`[Pull] Session ${targetId} not found locally, need full resync`)
      return { success: false, newMessageCount: 0, sessionId: targetId, needFullResync: true }
    }
    apiLogger.error(`[Pull] Incremental import failed: ${result.error}`)
    return { success: false, newMessageCount: 0, sessionId: targetId, error: result.error }
  }

  const externalId = deriveLocalSessionId(baseUrl, sess.remoteSessionId)
  apiLogger.info(`[Pull] First import via streamImport for "${sess.name}" (externalId=${externalId})`)
  const result = await worker.streamImport(tempFile, undefined, undefined, externalId)
  if (result.success) {
    const msgCount = result.diagnostics?.messagesWritten ?? 0
    apiLogger.info(`[Pull] streamImport OK: session=${result.sessionId}, messages=${msgCount}`)
    return { success: true, newMessageCount: msgCount, sessionId: result.sessionId }
  }
  apiLogger.error(`[Pull] streamImport failed: ${result.error}`)
  return { success: false, newMessageCount: 0, error: result.error }
}

// ==================== Core pull loop (per ImportSession) ====================

const MAX_PAGES_PER_PULL = 50

interface PullSessionResult {
  success: boolean
  newMessageCount: number
  error?: string
}

async function executePullSession(
  sourceId: string,
  ds: DataSource,
  sess: ImportSession
): Promise<PullSessionResult> {
  if (getImportingStatus()) {
    apiLogger.info(`[Pull] Skipping "${sess.name}": import in progress`)
    return { success: false, newMessageCount: 0, error: 'Import in progress' }
  }

  apiLogger.info(`[Pull] Pulling "${sess.name}" from ${ds.baseUrl}`)

  let totalNewMessages = 0
  let since = sess.lastPullAt
  let offset = 0
  let end: number | undefined
  let pageCount = 0
  let resyncAttempted = false

  try {
    while (pageCount < MAX_PAGES_PER_PULL) {
      pageCount++
      const tempFile = await fetchToTempFile(ds.baseUrl, sess.remoteSessionId, ds.token, { since, offset, end })

      try {
        const stat = fs.statSync(tempFile)
        apiLogger.info(`[Pull] "${sess.name}" page ${pageCount}: fetched ${stat.size} bytes`)
        if (stat.size === 0) {
          cleanupTempFile(tempFile)
          break
        }

        const sync = parseSyncFromFile(tempFile)
        const result = await importTempFile(ds.baseUrl, sess, tempFile)
        cleanupTempFile(tempFile)

        if (result.needFullResync && !resyncAttempted) {
          resyncAttempted = true
          apiLogger.info(`[Pull] Resetting since=0 for "${sess.name}" full resync`)
          since = 0
          offset = 0
          pageCount = 0
          sess.targetSessionId = ''
          sess.lastPullAt = 0
          updateImportSession(sourceId, sess.id, { targetSessionId: '', lastPullAt: 0 })
          continue
        }

        if (result.needFullResync) {
          const errMsg = 'Full resync failed'
          apiLogger.error(`[Pull] Full resync already attempted for "${sess.name}", aborting`)
          updateImportSession(sourceId, sess.id, {
            lastPullAt: Math.floor(Date.now() / 1000),
            lastStatus: 'error',
            lastError: errMsg,
          })
          notifyPullResult(sourceId, sess.id, 'error', errMsg)
          return { success: false, newMessageCount: 0, error: errMsg }
        }

        if (!result.success) {
          const errMsg = result.error || 'Import failed'
          updateImportSession(sourceId, sess.id, {
            lastPullAt: Math.floor(Date.now() / 1000),
            lastStatus: 'error',
            lastError: errMsg,
          })
          notifyPullResult(sourceId, sess.id, 'error', errMsg)
          return { success: false, newMessageCount: 0, error: errMsg }
        }

        if (!sess.targetSessionId && result.sessionId) {
          sess.targetSessionId = result.sessionId
          updateImportSession(sourceId, sess.id, { targetSessionId: result.sessionId })
        }

        totalNewMessages += result.newMessageCount

        if (!sync || !sync.hasMore) break

        if (sync.nextSince !== undefined) since = sync.nextSince
        if (sync.nextOffset !== undefined) offset = sync.nextOffset
        else offset = 0
        if (sync.watermark !== undefined && !end) end = sync.watermark
      } catch (importErr) {
        cleanupTempFile(tempFile)
        throw importErr
      }
    }

    if (pageCount >= MAX_PAGES_PER_PULL) {
      apiLogger.warn(`[Pull] "${sess.name}" reached page limit (${MAX_PAGES_PER_PULL}), data may be incomplete`)
    }

    updateImportSession(sourceId, sess.id, {
      lastPullAt: Math.floor(Date.now() / 1000),
      lastStatus: 'success',
      lastNewMessages: totalNewMessages,
      lastError: '',
    })
    if (totalNewMessages > 0) notifySessionListChanged()
    notifyPullResult(sourceId, sess.id, 'success', `+${totalNewMessages} messages`)
    return { success: true, newMessageCount: totalNewMessages }
  } catch (error: any) {
    const errMsg = error.message || 'Pull failed'
    apiLogger.error(`[Pull] Pull failed for "${sess.name}"`, error)
    updateImportSession(sourceId, sess.id, {
      lastPullAt: Math.floor(Date.now() / 1000),
      lastStatus: 'error',
      lastError: errMsg,
    })
    notifyPullResult(sourceId, sess.id, 'error', errMsg)
    return { success: false, newMessageCount: 0, error: errMsg }
  }
}

async function pullAllSessions(ds: DataSource): Promise<void> {
  for (const sess of ds.sessions) {
    await executePullSession(ds.id, ds, sess)
  }
}

// ==================== Timer management ====================

function startTimer(ds: DataSource): void {
  stopTimer(ds.id)
  if (!ds.enabled || ds.intervalMinutes < 1 || ds.sessions.length === 0) return

  const intervalMs = ds.intervalMinutes * 60 * 1000

  pullAllSessions(ds).catch((err) => {
    apiLogger.error('[Pull] Initial pull failed', err)
  })

  const timer = setInterval(() => {
    const current = loadDataSources().find((s) => s.id === ds.id)
    if (!current || !current.enabled || current.sessions.length === 0) {
      stopTimer(ds.id)
      return
    }
    pullAllSessions(current).catch((err) => {
      apiLogger.error('[Pull] Scheduled pull failed', err)
    })
  }, intervalMs)

  timers.set(ds.id, timer)
  apiLogger.info(`[Pull] Timer started for source ${ds.baseUrl} (${ds.sessions.length} sessions, every ${ds.intervalMinutes}min)`)
}

export function stopTimer(id: string): void {
  const timer = timers.get(id)
  if (timer) {
    clearInterval(timer)
    timers.delete(id)
  }
}

export function initScheduler(): void {
  if (initialized) return
  initialized = true

  const sources = loadDataSources()
  for (const ds of sources) {
    if (ds.enabled && ds.sessions.length > 0) {
      startTimer(ds)
    }
  }

  apiLogger.info(`[Pull] Initialized with ${sources.filter((s) => s.enabled).length} active sources`)
}

export function stopAllTimers(): void {
  for (const [id] of timers) {
    stopTimer(id)
  }
  initialized = false
  apiLogger.info('[Pull] All timers stopped')
}

export function reloadTimer(dsId: string): void {
  stopTimer(dsId)
  const ds = loadDataSources().find((s) => s.id === dsId)
  if (ds && ds.enabled) {
    startTimer(ds)
  }
}

export async function triggerPull(
  sourceId: string,
  sessionId?: string
): Promise<{ success: boolean; error?: string }> {
  const ds = loadDataSources().find((s) => s.id === sourceId)
  if (!ds) return { success: false, error: 'Data source not found' }

  if (sessionId) {
    const sess = ds.sessions.find((s) => s.id === sessionId)
    if (!sess) return { success: false, error: 'Session not found' }
    const result = await executePullSession(sourceId, ds, sess)
    return { success: result.success, error: result.error }
  }

  const errors: string[] = []
  for (const sess of ds.sessions) {
    const result = await executePullSession(sourceId, ds, sess)
    if (!result.success && result.error) errors.push(`${sess.name}: ${result.error}`)
  }
  if (errors.length > 0) {
    return { success: false, error: errors.join('; ') }
  }
  return { success: true }
}

/** Semantic alias for pulling all sessions in a source */
export async function triggerPullAll(sourceId: string): Promise<{ success: boolean; error?: string }> {
  return triggerPull(sourceId)
}
