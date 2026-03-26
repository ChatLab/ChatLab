/**
 * ChatLab API — Data source configuration management
 * Persisted to userData/settings/data-sources.json
 */

import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { getSettingsDir, ensureDir } from '../paths'

const CONFIG_FILE = 'data-sources.json'

export interface DataSource {
  id: string
  name: string
  url: string
  /** Remote API Bearer Token (optional) */
  token: string
  /** Pull interval in minutes */
  intervalMinutes: number
  /** Whether scheduled pulling is enabled */
  enabled: boolean
  /** Target session ID (empty string means create new each time) */
  targetSessionId: string
  /** Last pull timestamp (seconds) */
  lastPullAt: number
  /** Last pull status */
  lastStatus: 'idle' | 'success' | 'error'
  /** Last error message */
  lastError: string
  /** Number of new messages from last pull */
  lastNewMessages: number
  /** Created timestamp (seconds) */
  createdAt: number
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
    console.error('[DataSource] Failed to load config:', err)
  }
  return []
}

export function saveDataSources(sources: DataSource[]): void {
  try {
    ensureDir(getSettingsDir())
    fs.writeFileSync(getConfigPath(), JSON.stringify(sources, null, 2), 'utf-8')
  } catch (err) {
    console.error('[DataSource] Failed to save config:', err)
  }
}

export function generateId(): string {
  return `ds_${crypto.randomBytes(6).toString('hex')}`
}

export function addDataSource(partial: Omit<DataSource, 'id' | 'createdAt' | 'lastPullAt' | 'lastStatus' | 'lastError' | 'lastNewMessages'>): DataSource {
  const sources = loadDataSources()
  const ds: DataSource = {
    ...partial,
    id: generateId(),
    lastPullAt: 0,
    lastStatus: 'idle',
    lastError: '',
    lastNewMessages: 0,
    createdAt: Math.floor(Date.now() / 1000),
  }
  sources.push(ds)
  saveDataSources(sources)
  return ds
}

export function updateDataSource(id: string, updates: Partial<DataSource>): DataSource | null {
  const sources = loadDataSources()
  const idx = sources.findIndex((s) => s.id === id)
  if (idx === -1) return null
  sources[idx] = { ...sources[idx], ...updates, id }
  saveDataSources(sources)
  return sources[idx]
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
