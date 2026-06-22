/**
 * @openchatlab/sync — Pull engine
 *
 * Core paginated pull loop extracted from electron/main/api/pullScheduler.ts.
 * All platform-specific dependencies are injected via HttpFetcher, DataImporter, and SyncNotifier.
 */

import * as fs from 'fs'
import * as crypto from 'crypto'
import { NOOP_LOGGER } from './types'
import type {
  DataSource,
  ImportSession,
  HttpFetcher,
  DataImporter,
  SyncNotifier,
  SyncLogger,
  FetchParams,
  SyncMeta,
  PullSessionResult,
  PullProgress,
} from './types'
import type { DataSourceManager } from './data-source-manager'

const MAX_PAGES_PER_PULL = 5000
const PULL_OVERLAP_SECONDS = 60

// ==================== Helpers ====================

export function buildPullUrl(baseUrl: string, remoteSessionId: string, params: FetchParams): string {
  const base = `${baseUrl}/sessions/${remoteSessionId}/messages`
  const qs: string[] = ['format=chatlab']
  if (params.since !== undefined && params.since > 0) qs.push(`since=${params.since}`)
  if (params.offset !== undefined && params.offset > 0) qs.push(`offset=${params.offset}`)
  if (params.limit !== undefined && params.limit > 0) qs.push(`limit=${params.limit}`)
  return base + '?' + qs.join('&')
}

export function deriveLocalSessionId(baseUrl: string, remoteSessionId: string): string {
  const hash = crypto.createHash('sha256').update(`${baseUrl}\0${remoteSessionId}`).digest('hex').slice(0, 12)
  return `remote_${hash}`
}

export function parseSyncFromFile(filePath: string): SyncMeta | null {
  try {
    const isJsonl = filePath.endsWith('.jsonl')
    if (isJsonl) {
      const content = fs.readFileSync(filePath, 'utf-8')
      const lines = content.trimEnd().split('\n')
      for (let i = lines.length - 1; i >= Math.max(0, lines.length - 5); i--) {
        try {
          const obj = JSON.parse(lines[i])
          if (obj._type === 'sync') {
            return {
              hasMore: !!obj.hasMore,
              nextSince: obj.nextSince,
              nextOffset: obj.nextOffset,
              watermark: obj.watermark,
            }
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

function fileContainsMessages(filePath: string): boolean {
  try {
    if (filePath.endsWith('.jsonl')) {
      const content = fs.readFileSync(filePath, 'utf-8')
      for (const line of content.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const obj = JSON.parse(trimmed)
          if (obj._type === 'message') return true
        } catch {
          continue
        }
      }
      return false
    }

    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed.messages) && parsed.messages.length > 0
  } catch {
    return false
  }
}

function getMaxMessageTimestampFromFile(filePath: string): number | null {
  try {
    let maxTs: number | null = null
    const visitTimestamp = (value: unknown) => {
      const ts = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
      if (typeof ts === 'number' && Number.isFinite(ts)) {
        maxTs = maxTs === null ? ts : Math.max(maxTs, ts)
      }
    }

    if (filePath.endsWith('.jsonl')) {
      const content = fs.readFileSync(filePath, 'utf-8')
      for (const line of content.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const obj = JSON.parse(trimmed)
          if (obj._type === 'message') visitTimestamp(obj.timestamp)
        } catch {
          continue
        }
      }
      return maxTs
    }

    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed.messages)) {
      for (const message of parsed.messages) {
        visitTimestamp(message?.timestamp)
      }
    }
    return maxTs
  } catch {
    return null
  }
}

function cleanupTempFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  } catch {
    /* ignore */
  }
}

// ==================== Pull Engine ====================

export interface PullEngineOptions {
  fetcher: HttpFetcher
  importer: DataImporter
  notifier: SyncNotifier
  dsManager: DataSourceManager
  logger?: SyncLogger
  /** Return true when an import is already in progress (skip pull) */
  isImporting?: () => boolean
  /**
   * Called after a pull session completes successfully with the local session ID.
   * Used for post-import side effects (e.g. applying the platform owner profile).
   * Errors thrown by the hook never fail the pull.
   */
  onSessionImported?: (localSessionId: string) => void
}

export class PullEngine {
  private fetcher: HttpFetcher
  private importer: DataImporter
  private notifier: SyncNotifier
  private dsManager: DataSourceManager
  private logger: SyncLogger
  private isImporting: () => boolean
  private onSessionImported?: (localSessionId: string) => void
  private pullingSourceIds = new Set<string>()
  private progressMap = new Map<string, PullProgress>()

  constructor(options: PullEngineOptions) {
    this.fetcher = options.fetcher
    this.importer = options.importer
    this.notifier = options.notifier
    this.dsManager = options.dsManager
    this.logger = options.logger ?? NOOP_LOGGER
    this.isImporting = options.isImporting ?? (() => false)
    this.onSessionImported = options.onSessionImported
  }

  getProgress(): PullProgress[] {
    return Array.from(this.progressMap.values())
  }

  private async importTempFile(
    baseUrl: string,
    sess: ImportSession,
    tempFile: string
  ): Promise<{
    success: boolean
    newMessageCount: number
    sessionId?: string
    error?: string
    needFullResync?: boolean
  }> {
    let targetId = sess.targetSessionId
    if (!targetId) {
      const derived = deriveLocalSessionId(baseUrl, sess.remoteSessionId)
      if (this.importer.sessionExists(derived)) {
        targetId = derived
        this.logger.info(`[Pull] Reusing existing local session ${derived} for "${sess.name}"`)
      }
    }

    const externalId = deriveLocalSessionId(baseUrl, sess.remoteSessionId)
    return this.importer.importFile(tempFile, targetId || undefined, externalId)
  }

  async executePullSession(sourceId: string, ds: DataSource, sess: ImportSession): Promise<PullSessionResult> {
    const currentDs = this.dsManager.get(sourceId)
    if (!currentDs || !currentDs.sessions.some((s) => s.id === sess.id)) {
      this.logger.info(`[Pull] Skipping "${sess.name}": session no longer exists`)
      return { success: true, newMessageCount: 0 }
    }

    if (this.isImporting()) {
      this.logger.info(`[Pull] Skipping "${sess.name}": import in progress`)
      return { success: false, newMessageCount: 0, error: 'Import in progress' }
    }

    this.logger.info(`[Pull] Pulling "${sess.name}" from ${ds.baseUrl}`)

    let totalNewMessages = 0
    let since = sess.lastPullAt
    let offset: number | undefined
    let nextPullSince = sess.lastPullAt
    let pageCount = 0
    let resyncAttempted = false

    this.progressMap.set(sess.id, { sessionId: sess.id, sessionName: sess.name, current: 0, pages: 0, done: false })

    try {
      while (pageCount < MAX_PAGES_PER_PULL) {
        pageCount++
        const tempFile = await this.fetcher.fetchToTempFile(ds.baseUrl, sess.remoteSessionId, ds.token, {
          since,
          offset,
          limit: ds.pullLimit,
        })

        try {
          const stat = fs.statSync(tempFile)
          this.logger.info(`[Pull] "${sess.name}" page ${pageCount}: fetched ${stat.size} bytes`)

          const sync0 = parseSyncFromFile(tempFile)
          if (stat.size < 1024) {
            if (!fileContainsMessages(tempFile) && sync0?.hasMore === false) {
              cleanupTempFile(tempFile)
              const retryDelays = [2000, 3000, 5000]
              let retrySuccess = false
              let retryHasMore = false
              for (let ri = 0; ri < retryDelays.length; ri++) {
                this.logger.info(
                  `[Pull] "${sess.name}" page ${pageCount} got empty response, retry ${ri + 1}/${retryDelays.length} after ${retryDelays[ri]}ms`
                )
                await new Promise((r) => setTimeout(r, retryDelays[ri]))
                const retryFile = await this.fetcher.fetchToTempFile(ds.baseUrl, sess.remoteSessionId, ds.token, {
                  since,
                  offset,
                  limit: ds.pullLimit,
                })
                const retryStat = fs.statSync(retryFile)
                this.logger.info(`[Pull] "${sess.name}" retry ${ri + 1}: fetched ${retryStat.size} bytes`)
                const retrySync = parseSyncFromFile(retryFile)
                if (retryStat.size < 1024 && !fileContainsMessages(retryFile) && retrySync?.hasMore === false) {
                  // 空 retry 页也可能只返回服务端 watermark，跳过导入前仍要推进保存游标。
                  if (retrySync.nextSince !== undefined) nextPullSince = Math.max(nextPullSince, retrySync.nextSince)
                  cleanupTempFile(retryFile)
                  continue
                }
                const retryMaxTs = getMaxMessageTimestampFromFile(retryFile)
                const retryResult = await this.importTempFile(ds.baseUrl, sess, retryFile)
                cleanupTempFile(retryFile)

                if (retryResult.needFullResync && !resyncAttempted) {
                  resyncAttempted = true
                  this.logger.info(`[Pull] Resetting since=0 for "${sess.name}" full resync`)
                  since = 0
                  offset = undefined
                  nextPullSince = 0
                  pageCount = 0
                  sess.targetSessionId = ''
                  sess.lastPullAt = 0
                  this.dsManager.updateSession(sourceId, sess.id, { targetSessionId: '', lastPullAt: 0 })
                  retrySuccess = true
                  retryHasMore = true
                  break
                }

                if (retryResult.needFullResync) {
                  const errMsg = 'Full resync failed'
                  this.logger.error(`[Pull] Full resync already attempted for "${sess.name}", aborting`)
                  this.dsManager.updateSession(sourceId, sess.id, {
                    lastPullAt: Math.floor(Date.now() / 1000),
                    lastStatus: 'error',
                    lastError: errMsg,
                  })
                  this.notifier.onPullResult(sourceId, sess.id, 'error', errMsg)
                  this.markProgressDone(sess.id)
                  return { success: false, newMessageCount: 0, error: errMsg }
                }

                if (!retryResult.success) {
                  const errMsg = retryResult.error || 'Import failed'
                  this.dsManager.updateSession(sourceId, sess.id, {
                    lastPullAt: Math.floor(Date.now() / 1000),
                    lastStatus: 'error',
                    lastError: errMsg,
                  })
                  this.notifier.onPullResult(sourceId, sess.id, 'error', errMsg)
                  this.markProgressDone(sess.id)
                  return { success: false, newMessageCount: 0, error: errMsg }
                }

                if (retryResult.success && retryResult.sessionId && !sess.targetSessionId) {
                  sess.targetSessionId = retryResult.sessionId
                  this.dsManager.updateSession(sourceId, sess.id, { targetSessionId: retryResult.sessionId })
                }
                totalNewMessages += retryResult.newMessageCount
                if (retryMaxTs !== null) nextPullSince = Math.max(nextPullSince, retryMaxTs)
                // retry 终止页也可能携带服务端 watermark，必须保存，否则下次会重复拉取尾部窗口。
                if (retrySync?.nextSince !== undefined) nextPullSince = Math.max(nextPullSince, retrySync.nextSince)
                this.progressMap.set(sess.id, {
                  sessionId: sess.id,
                  sessionName: sess.name,
                  current: totalNewMessages,
                  pages: pageCount,
                  done: false,
                })
                if (retrySync?.hasMore && retrySync.nextSince !== undefined) {
                  since = retrySync.nextSince
                  offset = undefined
                } else if (retrySync?.hasMore && retrySync.nextOffset !== undefined) {
                  offset = retrySync.nextOffset
                }
                retryHasMore = !!retrySync?.hasMore
                retrySuccess = true
                break
              }
              if (!retrySuccess) break
              if (!retryHasMore) break
              continue
            }
          }

          if (stat.size === 0) {
            cleanupTempFile(tempFile)
            break
          }

          const sync = sync0
          const maxMessageTs = getMaxMessageTimestampFromFile(tempFile)
          const result = await this.importTempFile(ds.baseUrl, sess, tempFile)
          cleanupTempFile(tempFile)

          if (result.needFullResync && !resyncAttempted) {
            resyncAttempted = true
            this.logger.info(`[Pull] Resetting since=0 for "${sess.name}" full resync`)
            since = 0
            offset = undefined
            nextPullSince = 0
            pageCount = 0
            sess.targetSessionId = ''
            sess.lastPullAt = 0
            this.dsManager.updateSession(sourceId, sess.id, { targetSessionId: '', lastPullAt: 0 })
            continue
          }

          if (result.needFullResync) {
            const errMsg = 'Full resync failed'
            this.logger.error(`[Pull] Full resync already attempted for "${sess.name}", aborting`)
            this.dsManager.updateSession(sourceId, sess.id, {
              lastPullAt: Math.floor(Date.now() / 1000),
              lastStatus: 'error',
              lastError: errMsg,
            })
            this.notifier.onPullResult(sourceId, sess.id, 'error', errMsg)
            this.markProgressDone(sess.id)
            return { success: false, newMessageCount: 0, error: errMsg }
          }

          if (!result.success) {
            const errMsg = result.error || 'Import failed'
            this.dsManager.updateSession(sourceId, sess.id, {
              lastPullAt: Math.floor(Date.now() / 1000),
              lastStatus: 'error',
              lastError: errMsg,
            })
            this.notifier.onPullResult(sourceId, sess.id, 'error', errMsg)
            this.markProgressDone(sess.id)
            return { success: false, newMessageCount: 0, error: errMsg }
          }

          if (!sess.targetSessionId && result.sessionId) {
            sess.targetSessionId = result.sessionId
            this.dsManager.updateSession(sourceId, sess.id, { targetSessionId: result.sessionId })
          }

          totalNewMessages += result.newMessageCount
          if (maxMessageTs !== null) nextPullSince = Math.max(nextPullSince, maxMessageTs)
          this.progressMap.set(sess.id, {
            sessionId: sess.id,
            sessionName: sess.name,
            current: totalNewMessages,
            pages: pageCount,
            done: false,
          })

          if (sync?.nextSince !== undefined) nextPullSince = Math.max(nextPullSince, sync.nextSince)

          if (!sync || !sync.hasMore) break

          // 游标推进优先使用时间戳链；旧数据源只返回 nextOffset 时，继续使用 offset 续拉同一个 since 窗口。
          if (sync.nextSince !== undefined) {
            since = sync.nextSince
            offset = undefined
          } else if (sync.nextOffset !== undefined) {
            offset = sync.nextOffset
          } else {
            this.logger.warn(`[Pull] "${sess.name}" returned hasMore=true without nextSince or nextOffset, stopping`)
            break
          }
        } catch (importErr) {
          cleanupTempFile(tempFile)
          throw importErr
        }
      }

      if (pageCount >= MAX_PAGES_PER_PULL) {
        this.logger.warn(`[Pull] "${sess.name}" reached page limit (${MAX_PAGES_PER_PULL}), data may be incomplete`)
      }

      // 保留 overlap 窗口，但成功拉取未观察到更新游标时不能把已保存游标向后移动。
      const savedLastPullAt = Math.max(sess.lastPullAt, Math.max(0, nextPullSince - PULL_OVERLAP_SECONDS))
      this.dsManager.updateSession(sourceId, sess.id, {
        lastPullAt: savedLastPullAt,
        lastStatus: 'success',
        lastNewMessages: totalNewMessages,
        lastError: '',
      })
      if (totalNewMessages > 0) this.notifier.onSessionListChanged()
      this.notifier.onPullResult(sourceId, sess.id, 'success', `+${totalNewMessages} messages`)
      this.markProgressDone(sess.id)
      if (this.onSessionImported && sess.targetSessionId) {
        try {
          this.onSessionImported(sess.targetSessionId)
        } catch (hookErr) {
          this.logger.warn(`[Pull] onSessionImported hook failed for "${sess.name}": ${hookErr}`)
        }
      }
      return { success: true, newMessageCount: totalNewMessages }
    } catch (error: any) {
      const errMsg = error.message || 'Pull failed'
      this.logger.error(`[Pull] Pull failed for "${sess.name}"`, error)
      this.dsManager.updateSession(sourceId, sess.id, {
        lastPullAt: Math.floor(Date.now() / 1000),
        lastStatus: 'error',
        lastError: errMsg,
      })
      this.notifier.onPullResult(sourceId, sess.id, 'error', errMsg)
      this.markProgressDone(sess.id)
      return { success: false, newMessageCount: 0, error: errMsg }
    }
  }

  private markProgressDone(sessionId: string): void {
    const p = this.progressMap.get(sessionId)
    if (p) {
      p.done = true
      setTimeout(() => this.progressMap.delete(sessionId), 5000)
    }
  }

  async pullAllSessions(ds: DataSource): Promise<void> {
    if (this.pullingSourceIds.has(ds.id)) {
      this.logger.info(`[Pull] Skipping pullAllSessions for "${ds.baseUrl}": pull already in progress`)
      return
    }
    this.pullingSourceIds.add(ds.id)
    try {
      for (const sess of ds.sessions) {
        await this.executePullSession(ds.id, ds, sess)
      }
    } finally {
      this.pullingSourceIds.delete(ds.id)
    }
  }

  async triggerPull(sourceId: string, sessionId?: string): Promise<{ success: boolean; error?: string }> {
    const ds = this.dsManager.get(sourceId)
    if (!ds) return { success: false, error: 'Data source not found' }

    if (sessionId) {
      const sess = ds.sessions.find((s) => s.id === sessionId)
      if (!sess) return { success: false, error: 'Session not found' }
      const result = await this.executePullSession(sourceId, ds, sess)
      return { success: result.success, error: result.error }
    }

    if (this.pullingSourceIds.has(sourceId)) {
      this.logger.info(`[Pull] Skipping triggerPull for source ${sourceId}: pull already in progress`)
      return { success: true }
    }
    this.pullingSourceIds.add(sourceId)
    try {
      const errors: string[] = []
      for (const sess of ds.sessions) {
        const result = await this.executePullSession(sourceId, ds, sess)
        if (!result.success && result.error) errors.push(`${sess.name}: ${result.error}`)
      }
      if (errors.length > 0) {
        return { success: false, error: errors.join('; ') }
      }
      return { success: true }
    } finally {
      this.pullingSourceIds.delete(sourceId)
    }
  }

  async triggerPullAll(sourceId: string): Promise<{ success: boolean; error?: string }> {
    return this.triggerPull(sourceId)
  }
}
