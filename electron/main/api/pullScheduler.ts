/**
 * ChatLab API — Pull scheduler
 * Periodically fetches ChatLab Format data from external sources and imports it
 */

import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { net } from 'electron'
import { getTempDir } from '../paths'
import * as worker from '../worker/workerManager'
import { loadDataSources, saveDataSources, type DataSource } from './dataSource'
import { getImportingStatus } from './routes/import'

const timers = new Map<string, ReturnType<typeof setInterval>>()
let initialized = false

function getTempFilePath(ext: string): string {
  const id = crypto.randomBytes(8).toString('hex')
  return path.join(getTempDir(), `pull-import-${id}${ext}`)
}

function cleanupTempFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  } catch { /* ignore */ }
}

function notifySessionListChanged(): void {
  try {
    const { BrowserWindow } = require('electron')
    const wins = BrowserWindow.getAllWindows()
    for (const win of wins) {
      win.webContents.send('api:importCompleted')
    }
  } catch { /* ignore */ }
}

function notifyPullResult(dsId: string, status: 'success' | 'error', detail: string): void {
  try {
    const { BrowserWindow } = require('electron')
    const wins = BrowserWindow.getAllWindows()
    for (const win of wins) {
      win.webContents.send('api:pullResult', { dsId, status, detail })
    }
  } catch { /* ignore */ }
}

/**
 * Fetch data from remote URL to a temporary file
 */
async function fetchToTempFile(ds: DataSource): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const url = ds.url.includes('?')
      ? `${ds.url}&since=${ds.lastPullAt}`
      : `${ds.url}?since=${ds.lastPullAt}`

    const request = net.request(url)

    if (ds.token) {
      request.setHeader('Authorization', `Bearer ${ds.token}`)
    }
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

      response.on('data', (chunk: Buffer) => {
        writeStream!.write(chunk)
      })

      response.on('end', () => {
        writeStream!.end(() => {
          resolve(tempFile)
        })
      })

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

/**
 * Execute a single pull operation
 */
async function executePull(ds: DataSource): Promise<void> {
  if (getImportingStatus()) {
    console.log(`[PullScheduler] Skipping pull for "${ds.name}": import in progress`)
    return
  }

  console.log(`[PullScheduler] Pulling from "${ds.name}" (${ds.url})`)

  const sources = loadDataSources()
  const idx = sources.findIndex((s) => s.id === ds.id)
  if (idx === -1) return

  let tempFile = ''
  try {
    tempFile = await fetchToTempFile(ds)

    // Skip empty responses
    const stat = fs.statSync(tempFile)
    if (stat.size === 0) {
      console.log(`[PullScheduler] Empty response from "${ds.name}", skipping`)
      sources[idx].lastPullAt = Math.floor(Date.now() / 1000)
      sources[idx].lastStatus = 'success'
      sources[idx].lastNewMessages = 0
      saveDataSources(sources)
      return
    }

    let result: any
    if (ds.targetSessionId) {
      result = await worker.incrementalImport(ds.targetSessionId, tempFile)
      if (result.success) {
        try {
          await worker.generateIncrementalSessions(ds.targetSessionId)
        } catch { /* ignore */ }
      }
    } else {
      result = await worker.streamImport(tempFile)
    }

    sources[idx].lastPullAt = Math.floor(Date.now() / 1000)

    if (result.success) {
      sources[idx].lastStatus = 'success'
      sources[idx].lastNewMessages = result.newMessageCount ?? 0
      sources[idx].lastError = ''
      notifySessionListChanged()
      notifyPullResult(ds.id, 'success', `Added ${sources[idx].lastNewMessages} new messages`)
    } else {
      sources[idx].lastStatus = 'error'
      sources[idx].lastError = result.error || 'Import failed'
      notifyPullResult(ds.id, 'error', sources[idx].lastError)
    }

    saveDataSources(sources)
  } catch (error: any) {
    console.error(`[PullScheduler] Pull failed for "${ds.name}":`, error)
    sources[idx].lastPullAt = Math.floor(Date.now() / 1000)
    sources[idx].lastStatus = 'error'
    sources[idx].lastError = error.message || 'Pull failed'
    saveDataSources(sources)
    notifyPullResult(ds.id, 'error', sources[idx].lastError)
  } finally {
    if (tempFile) cleanupTempFile(tempFile)
  }
}

/**
 * Start timer for a data source
 */
function startTimer(ds: DataSource): void {
  stopTimer(ds.id)

  if (!ds.enabled || ds.intervalMinutes < 1) return

  const intervalMs = ds.intervalMinutes * 60 * 1000

  // Execute immediately on start
  executePull(ds).catch((err) => {
    console.error(`[PullScheduler] Initial pull failed:`, err)
  })

  const timer = setInterval(() => {
    const current = loadDataSources().find((s) => s.id === ds.id)
    if (!current || !current.enabled) {
      stopTimer(ds.id)
      return
    }
    executePull(current).catch((err) => {
      console.error(`[PullScheduler] Scheduled pull failed:`, err)
    })
  }, intervalMs)

  timers.set(ds.id, timer)
  console.log(`[PullScheduler] Timer started for "${ds.name}" (every ${ds.intervalMinutes}min)`)
}

function stopTimer(id: string): void {
  const timer = timers.get(id)
  if (timer) {
    clearInterval(timer)
    timers.delete(id)
  }
}

/**
 * Initialize scheduler: start timers for all enabled data sources
 */
export function initScheduler(): void {
  if (initialized) return
  initialized = true

  const sources = loadDataSources()
  for (const ds of sources) {
    if (ds.enabled) {
      startTimer(ds)
    }
  }

  console.log(`[PullScheduler] Initialized with ${sources.filter((s) => s.enabled).length} active sources`)
}

/**
 * Stop all active timers
 */
export function stopAllTimers(): void {
  for (const [id] of timers) {
    stopTimer(id)
  }
  initialized = false
  console.log('[PullScheduler] All timers stopped')
}

/**
 * Reload timer for a single data source (called after config changes)
 */
export function reloadTimer(dsId: string): void {
  stopTimer(dsId)
  const ds = loadDataSources().find((s) => s.id === dsId)
  if (ds && ds.enabled) {
    startTimer(ds)
  }
}

/**
 * Manually trigger a single pull
 */
export async function triggerPull(dsId: string): Promise<{ success: boolean; error?: string }> {
  const ds = loadDataSources().find((s) => s.id === dsId)
  if (!ds) return { success: false, error: 'Data source not found' }

  try {
    await executePull(ds)
    const updated = loadDataSources().find((s) => s.id === dsId)
    if (updated?.lastStatus === 'error') {
      return { success: false, error: updated.lastError }
    }
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}
