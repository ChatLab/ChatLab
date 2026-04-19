/**
 * ChatLab API — Configuration management
 * Persisted to userData/settings/api-server.json
 */

import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { getSettingsDir, ensureDir } from '../paths'
import { apiLogger } from './logger'

const CONFIG_FILE = 'api-server.json'

export interface ApiServerConfig {
  enabled: boolean
  port: number
  token: string
  createdAt: number
}

const DEFAULT_CONFIG: ApiServerConfig = {
  enabled: false,
  port: 5200,
  token: '',
  createdAt: 0,
}

function getConfigPath(): string {
  return path.join(getSettingsDir(), CONFIG_FILE)
}

function generateToken(): string {
  return `clb_${crypto.randomBytes(32).toString('hex')}`
}

export function loadConfig(): ApiServerConfig {
  try {
    const filePath = getConfigPath()
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<ApiServerConfig>
      return { ...DEFAULT_CONFIG, ...parsed }
    }
  } catch (err) {
    apiLogger.error('[Config] Failed to load config', err)
  }
  return { ...DEFAULT_CONFIG }
}

export function saveConfig(config: ApiServerConfig): void {
  try {
    ensureDir(getSettingsDir())
    fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8')
  } catch (err) {
    apiLogger.error('[Config] Failed to save config', err)
  }
}

export function updateConfig(partial: Partial<ApiServerConfig>): ApiServerConfig {
  const current = loadConfig()
  const updated = { ...current, ...partial }
  saveConfig(updated)
  return updated
}

/**
 * Ensure token exists (auto-generated on first enable)
 */
export function ensureToken(config: ApiServerConfig): ApiServerConfig {
  if (!config.token) {
    config.token = generateToken()
    config.createdAt = Math.floor(Date.now() / 1000)
    saveConfig(config)
  }
  return config
}

export function regenerateToken(): ApiServerConfig {
  const config = loadConfig()
  config.token = generateToken()
  config.createdAt = Math.floor(Date.now() / 1000)
  saveConfig(config)
  return config
}
