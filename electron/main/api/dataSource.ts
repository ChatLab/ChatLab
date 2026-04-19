/**
 * ChatLab API — Data source configuration management (hierarchical model)
 * Persisted to userData/settings/data-sources.json
 *
 * DataSource (server) → ImportSession[] (subscribed conversations)
 */

import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { getSettingsDir, ensureDir } from '../paths'
import { apiLogger } from './logger'

const CONFIG_FILE = 'data-sources.json'

export interface ImportSession {
  id: string
  name: string
  remoteSessionId: string
  targetSessionId: string
  lastPullAt: number
  lastStatus: 'idle' | 'success' | 'error'
  lastError: string
  lastNewMessages: number
}

export interface DataSource {
  id: string
  name: string
  baseUrl: string
  token: string
  intervalMinutes: number
  enabled: boolean
  createdAt: number
  sessions: ImportSession[]
}

function getConfigPath(): string {
  return path.join(getSettingsDir(), CONFIG_FILE)
}

export function loadDataSources(): DataSource[] {
  try {
    const filePath = getConfigPath()
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8')
      return JSON.parse(raw) as DataSource[]
    }
  } catch (err) {
    apiLogger.error('[DataSource] Failed to load config', err)
  }
  return []
}

export function saveDataSources(sources: DataSource[]): void {
  try {
    ensureDir(getSettingsDir())
    fs.writeFileSync(getConfigPath(), JSON.stringify(sources, null, 2), 'utf-8')
  } catch (err) {
    apiLogger.error('[DataSource] Failed to save config', err)
  }
}

export function generateId(prefix: string = 'ds'): string {
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

// ==================== DataSource CRUD ====================

export function addDataSource(partial: { name?: string; baseUrl: string; token: string; intervalMinutes: number }): DataSource {
  const sources = loadDataSources()
  const ds: DataSource = {
    id: generateId('src'),
    name: partial.name || '',
    baseUrl: normalizeBaseUrl(partial.baseUrl),
    token: partial.token,
    intervalMinutes: partial.intervalMinutes,
    enabled: true,
    createdAt: Math.floor(Date.now() / 1000),
    sessions: [],
  }
  sources.push(ds)
  saveDataSources(sources)
  return ds
}

export function updateDataSource(
  id: string,
  updates: Partial<Pick<DataSource, 'name' | 'baseUrl' | 'token' | 'intervalMinutes' | 'enabled'>>
): DataSource | null {
  const sources = loadDataSources()
  const idx = sources.findIndex((s) => s.id === id)
  if (idx === -1) return null
  const ds = sources[idx]
  if (updates.name !== undefined) ds.name = updates.name
  if (updates.baseUrl !== undefined) ds.baseUrl = normalizeBaseUrl(updates.baseUrl)
  if (updates.token !== undefined) ds.token = updates.token
  if (updates.intervalMinutes !== undefined) ds.intervalMinutes = updates.intervalMinutes
  if (updates.enabled !== undefined) ds.enabled = updates.enabled
  saveDataSources(sources)
  return ds
}

export function deleteDataSource(id: string): boolean {
  const sources = loadDataSources()
  const filtered = sources.filter((s) => s.id !== id)
  if (filtered.length === sources.length) return false
  saveDataSources(filtered)
  return true
}

export function getDataSource(id: string): DataSource | null {
  const sources = loadDataSources()
  return sources.find((s) => s.id === id) || null
}

// ==================== ImportSession CRUD ====================

export function addImportSessions(
  sourceId: string,
  sessions: Array<{ name: string; remoteSessionId: string }>
): ImportSession[] {
  const sources = loadDataSources()
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
  saveDataSources(sources)
  return added
}

export function removeImportSession(sourceId: string, sessionId: string): boolean {
  const sources = loadDataSources()
  const ds = sources.find((s) => s.id === sourceId)
  if (!ds) return false
  const before = ds.sessions.length
  ds.sessions = ds.sessions.filter((s) => s.id !== sessionId)
  if (ds.sessions.length === before) return false
  saveDataSources(sources)
  return true
}

export function updateImportSession(
  sourceId: string,
  sessionId: string,
  updates: Partial<ImportSession>
): ImportSession | null {
  const sources = loadDataSources()
  const ds = sources.find((s) => s.id === sourceId)
  if (!ds) return null
  const sess = ds.sessions.find((s) => s.id === sessionId)
  if (!sess) return null
  Object.assign(sess, updates, { id: sessionId })
  saveDataSources(sources)
  return sess
}
