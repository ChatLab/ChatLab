import { app, ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { AnalyticsService } from '@openchatlab/node-runtime'
import { getSystemDataDir } from './paths'

const APTABASE_APP_KEY = process.env.APTABASE_APP_KEY

let _service: AnalyticsService | null = null

function migrateAnalyticsIfNeeded(systemDir: string): void {
  const newPath = path.join(systemDir, 'analytics.json')
  if (fs.existsSync(newPath)) return
  try {
    const oldPath = path.join(app.getPath('userData'), 'analytics.json')
    if (fs.existsSync(oldPath)) fs.copyFileSync(oldPath, newPath)
  } catch (_e) {
    // Non-critical migration, ignore errors
  }
}

function getService(): AnalyticsService | null {
  if (!APTABASE_APP_KEY) return null
  if (!_service) {
    const systemDir = getSystemDataDir()
    migrateAnalyticsIfNeeded(systemDir)
    _service = new AnalyticsService(systemDir, APTABASE_APP_KEY, app.getVersion())
  }
  return _service
}

export function initAnalytics(): void {
  // Service is initialized lazily; no-op here unless we want eager validation.
  if (!APTABASE_APP_KEY) return
  getService()
}

export function registerAnalyticsHandlers(): void {
  ipcMain.handle('analytics:getEnabled', () => {
    return getService()?.getEnabled() ?? true
  })

  ipcMain.handle('analytics:setEnabled', (_, enabled: boolean) => {
    getService()?.setEnabled(enabled)
    return { success: true }
  })

  ipcMain.handle('analytics:trackDailyActive', (_, locale: string) => {
    getService()
      ?.trackDailyActive({ platform: 'desktop', locale })
      .catch((e) => console.error('[Analytics] Failed to report daily active:', e))
  })
}

export function trackAppEvent(eventName: string, properties?: Record<string, string | number>): void {
  getService()
    ?.track(eventName, properties)
    .catch((e) => console.error(`[Analytics] Failed to report event ${eventName}:`, e))
}
