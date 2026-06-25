/**
 * @openchatlab/sync — API server config manager
 *
 * Extracted from electron/main/api/config.ts.
 * Parameterized by `configDir` so it works in both Electron and CLI.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { NOOP_LOGGER } from './types'
import type { ApiServerConfig, SyncLogger } from './types'

const CONFIG_FILE = 'api-server.json'

const DEFAULT_CONFIG: ApiServerConfig = {
  enabled: false,
  port: 3110,
  token: '',
  createdAt: 0,
}

function generateToken(): string {
  return `clb_${crypto.randomBytes(32).toString('hex')}`
}

export class ConfigManager {
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

  load(): ApiServerConfig {
    try {
      const filePath = this.getConfigPath()
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8')
        const parsed = JSON.parse(raw) as Partial<ApiServerConfig>
        return { ...DEFAULT_CONFIG, ...parsed }
      }
    } catch (err) {
      this.logger.error('[Config] Failed to load config', err)
    }
    return { ...DEFAULT_CONFIG }
  }

  save(config: ApiServerConfig): void {
    try {
      this.ensureDir()
      fs.writeFileSync(this.getConfigPath(), JSON.stringify(config, null, 2), 'utf-8')
    } catch (err) {
      this.logger.error('[Config] Failed to save config', err)
    }
  }

  update(partial: Partial<ApiServerConfig>): ApiServerConfig {
    const current = this.load()
    const updated = { ...current, ...partial }
    this.save(updated)
    return updated
  }

  ensureToken(config: ApiServerConfig): ApiServerConfig {
    if (!config.token) {
      config.token = generateToken()
      config.createdAt = Math.floor(Date.now() / 1000)
      this.save(config)
    }
    return config
  }

  regenerateToken(): ApiServerConfig {
    const config = this.load()
    config.token = generateToken()
    config.createdAt = Math.floor(Date.now() / 1000)
    this.save(config)
    return config
  }
}
