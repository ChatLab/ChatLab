/**
 * @openchatlab/sync — Data source configuration manager
 *
 * Extracted from electron/main/api/dataSource.ts.
 * Parameterized by `configDir` so it works in both Electron and CLI.
 *
 * DataSource (remote server) → ImportSession[] (subscribed conversations)
 */

import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { NOOP_LOGGER } from './types'
import type { DataSource, DataSourceUpdatable, ImportSession, SyncLogger } from './types'

const CONFIG_FILE = 'data-sources.json'

function generateId(prefix: string = 'ds'): string {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`
}

export function normalizeBaseUrl(input: string): string {
  let url = input.trim().replace(/\/+$/, '')
  if (url && !/^https?:\/\//i.test(url)) {
    url = `http://${url}`
  }
  if (url && !url.endsWith('/api/v1')) {
    url = url.replace(/\/api\/v1$/, '') + '/api/v1'
  }
  return url
}

function isValidDataSourceArray(data: unknown): data is DataSource[] {
  if (!Array.isArray(data)) return false
  return data.every((item) => item && typeof item === 'object' && Array.isArray((item as any).sessions))
}

export class DataSourceManager {
  private configDir: string
  private logger: SyncLogger

  constructor(configDir: string, logger?: SyncLogger) {
    this.configDir = configDir
    this.logger = logger ?? NOOP_LOGGER
  }

  private getConfigPath(): string {
    return path.join(this.configDir, CONFIG_FILE)
  }

  private ensureDir(): void {
    fs.mkdirSync(this.configDir, { recursive: true })
  }

  // ==================== Load / Save ====================

  loadAll(): DataSource[] {
    try {
      const filePath = this.getConfigPath()
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8')
        const parsed = JSON.parse(raw)

        if (!isValidDataSourceArray(parsed)) {
          this.logger.warn('[DataSource] Incompatible config format detected, returning empty.')
          return []
        }

        for (const ds of parsed) {
          if (!ds.pullLimit) ds.pullLimit = 1000
        }
        return parsed
      }
    } catch (err) {
      this.logger.error('[DataSource] Failed to load config', err)
    }
    return []
  }

  private saveAll(sources: DataSource[]): void {
    try {
      this.ensureDir()
      fs.writeFileSync(this.getConfigPath(), JSON.stringify(sources, null, 2), 'utf-8')
    } catch (err) {
      this.logger.error('[DataSource] Failed to save config', err)
    }
  }

  // ==================== DataSource CRUD ====================

  get(id: string): DataSource | null {
    return this.loadAll().find((s) => s.id === id) || null
  }

  add(partial: {
    name?: string
    baseUrl: string
    token: string
    intervalMinutes: number
    pullLimit?: number
  }): DataSource {
    const sources = this.loadAll()
    const ds: DataSource = {
      id: generateId('src'),
      name: partial.name || '',
      baseUrl: normalizeBaseUrl(partial.baseUrl),
      token: partial.token,
      intervalMinutes: partial.intervalMinutes,
      pullLimit: partial.pullLimit || 1000,
      enabled: true,
      createdAt: Math.floor(Date.now() / 1000),
      sessions: [],
    }
    sources.push(ds)
    this.saveAll(sources)
    return ds
  }

  update(id: string, updates: DataSourceUpdatable): DataSource | null {
    const sources = this.loadAll()
    const idx = sources.findIndex((s) => s.id === id)
    if (idx === -1) return null
    const ds = sources[idx]
    if (updates.name !== undefined) ds.name = updates.name
    if (updates.baseUrl !== undefined) ds.baseUrl = normalizeBaseUrl(updates.baseUrl)
    if (updates.token !== undefined) ds.token = updates.token
    if (updates.intervalMinutes !== undefined) ds.intervalMinutes = updates.intervalMinutes
    if (updates.pullLimit !== undefined) ds.pullLimit = updates.pullLimit
    if (updates.enabled !== undefined) ds.enabled = updates.enabled
    this.saveAll(sources)
    return ds
  }

  delete(id: string): boolean {
    const sources = this.loadAll()
    const filtered = sources.filter((s) => s.id !== id)
    if (filtered.length === sources.length) return false
    this.saveAll(filtered)
    return true
  }

  // ==================== ImportSession CRUD ====================

  addSessions(sourceId: string, sessions: Array<{ name: string; remoteSessionId: string }>): ImportSession[] {
    const sources = this.loadAll()
    const ds = sources.find((s) => s.id === sourceId)
    if (!ds) return []

    const added: ImportSession[] = []
    for (const sess of sessions) {
      if (ds.sessions.some((s) => s.remoteSessionId === sess.remoteSessionId)) continue
      const imp: ImportSession = {
        id: generateId('sess'),
        name: sess.name,
        remoteSessionId: sess.remoteSessionId,
        targetSessionId: '',
        lastPullAt: 0,
        lastStatus: 'idle',
        lastError: '',
        lastNewMessages: 0,
      }
      ds.sessions.push(imp)
      added.push(imp)
    }
    this.saveAll(sources)
    return added
  }

  removeSession(sourceId: string, sessionId: string): ImportSession | null {
    const sources = this.loadAll()
    const ds = sources.find((s) => s.id === sourceId)
    if (!ds) return null
    const removed = ds.sessions.find((s) => s.id === sessionId)
    if (!removed) return null
    ds.sessions = ds.sessions.filter((s) => s.id !== sessionId)
    this.saveAll(sources)
    return removed
  }

  updateSession(sourceId: string, sessionId: string, updates: Partial<ImportSession>): ImportSession | null {
    const sources = this.loadAll()
    const ds = sources.find((s) => s.id === sourceId)
    if (!ds) return null
    const sess = ds.sessions.find((s) => s.id === sessionId)
    if (!sess) return null
    Object.assign(sess, updates, { id: sessionId })
    this.saveAll(sources)
    return sess
  }
}
