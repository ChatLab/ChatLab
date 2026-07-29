import { app, ipcMain } from 'electron'
import { AnalyticsService, appLogger } from '@openchatlab/node-runtime'
import type { AnalyticsEventName } from '@openchatlab/shared-types'
import { getDesktopLlmRuntimeStores } from './ai/llm'
import { getSystemDataDir } from './paths/locations'

let _service: AnalyticsService | null = null

function getService(): AnalyticsService | null {
  if (!_service) {
    const systemDir = getSystemDataDir()
    _service = new AnalyticsService(systemDir, {
      appVersion: app.getVersion(),
      appType: 'desktop',
      getAiModelConfigured: () => getDesktopLlmRuntimeStores().llmConfigStore.hasConfiguredModel(),
    })
  }
  return _service
}

export function initAnalytics(): void {
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
      ?.trackDailyActive({ app_locale: locale })
      .catch((error) => appLogger.error('analytics', 'Failed to report daily active event', error))
  })

  ipcMain.handle('analytics:track', (_, eventName: AnalyticsEventName, properties?: Record<string, unknown>) => {
    getService()
      ?.track(eventName, properties)
      .catch((error) => appLogger.error('analytics', `Failed to report ${eventName} event`, error))
  })
}

export function trackAppEvent(eventName: AnalyticsEventName, properties?: Record<string, unknown>): void {
  getService()
    ?.track(eventName, properties)
    .catch((error) => appLogger.error('analytics', `Failed to report ${eventName} event`, error))
}
