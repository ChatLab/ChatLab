/**
 * @openchatlab/sync — Timer-based pull scheduler
 *
 * Manages one timer per DataSource; each tick pulls all ImportSessions.
 * Pure setInterval logic, no platform dependencies.
 */

import { NOOP_LOGGER } from './types'
import type { DataSource, SyncLogger } from './types'
import type { DataSourceManager } from './data-source-manager'
import type { PullEngine } from './pull-engine'

const timers = new Map<string, ReturnType<typeof setInterval>>()
let initialized = false

export interface SchedulerOptions {
  dsManager: DataSourceManager
  pullEngine: PullEngine
  logger?: SyncLogger
}

let _dsManager: DataSourceManager
let _pullEngine: PullEngine
let _logger: SyncLogger

function startTimer(ds: DataSource, skipInitialPull = false): void {
  stopTimer(ds.id)
  if (!ds.enabled || ds.intervalMinutes < 1 || ds.sessions.length === 0) return

  const intervalMs = ds.intervalMinutes * 60 * 1000

  if (!skipInitialPull) {
    _pullEngine.pullAllSessions(ds).catch((err) => {
      _logger.error('[Pull] Initial pull failed', err)
    })
  }

  const timer = setInterval(() => {
    try {
      const current = _dsManager.loadAll().find((s) => s.id === ds.id)
      if (!current || !current.enabled || current.sessions.length === 0) {
        stopTimer(ds.id)
        return
      }
      _pullEngine.pullAllSessions(current).catch((err) => {
        _logger.error('[Pull] Scheduled pull failed', err)
      })
    } catch (err) {
      stopTimer(ds.id)
      _logger.error('[Pull] Scheduled pull stopped because data source config could not be loaded', err)
    }
  }, intervalMs)

  timers.set(ds.id, timer)
  _logger.info(
    `[Pull] Timer started for source ${ds.baseUrl} (${ds.sessions.length} sessions, every ${ds.intervalMinutes}min)`
  )
}

export function stopTimer(id: string): void {
  const timer = timers.get(id)
  if (timer) {
    clearInterval(timer)
    timers.delete(id)
  }
}

export function initScheduler(options: SchedulerOptions): void {
  if (initialized) return

  _dsManager = options.dsManager
  _pullEngine = options.pullEngine
  _logger = options.logger ?? NOOP_LOGGER

  let sources: DataSource[]
  try {
    sources = _dsManager.loadAll()
  } catch (err) {
    _logger.error('[Pull] Scheduler not started because data source config could not be loaded', err)
    return
  }
  initialized = true
  for (const ds of sources) {
    if (ds.enabled && ds.sessions.length > 0) {
      startTimer(ds)
    }
  }

  _logger.info(`[Pull] Initialized with ${sources.filter((s) => s.enabled).length} active sources`)
}

export function stopAllTimers(): void {
  for (const [id] of timers) {
    stopTimer(id)
  }
  initialized = false
  _logger?.info('[Pull] All timers stopped')
}

export function reloadTimer(dsId: string, skipInitialPull = false): void {
  stopTimer(dsId)
  const ds = _dsManager?.loadAll().find((s) => s.id === dsId)
  if (ds && ds.enabled) {
    startTimer(ds, skipInitialPull)
  }
}
