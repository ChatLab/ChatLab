/**
 * CliWebPlatformAdapter — CLI Web 平台能力实现
 *
 * 大部分原生平台能力在 CLI Web 下不可用，提供安全的降级行为。
 */

import type {
  PlatformAdapter,
  OpenDialogOptions,
  OpenDialogResult,
  RemoteConfigResult,
  CheckUpdateResult,
  PerformUpdateResult,
} from './types'
import { fetchWithAuth } from '../utils/http'
import { reportError } from '../log-report'

declare const __APP_VERSION__: string

export class CliWebPlatformAdapter implements PlatformAdapter {
  async getVersion(): Promise<string> {
    return typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'cli-web'
  }

  async fetchRemoteConfig(url: string): Promise<RemoteConfigResult> {
    try {
      const res = await fetch(url)
      if (!res.ok) return { success: false, error: `HTTP ${res.status}` }
      const contentType = res.headers.get('content-type') || ''
      const isJson = contentType.includes('application/json') || url.split('?')[0].endsWith('.json')
      const data = isJson ? await res.json() : await res.text()
      return { success: true, data }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }

  setThemeSource(_theme: 'system' | 'light' | 'dark'): void {
    // Web 模式下主题通过 CSS class 切换，不需要 IPC
  }

  async getOpenAtLogin(): Promise<boolean> {
    return false
  }

  async setOpenAtLogin(_enabled: boolean): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Not available in CLI Web' }
  }

  async getAnalyticsEnabled(): Promise<boolean> {
    try {
      const resp = await fetchWithAuth('/_web/telemetry/enabled')
      const data = (await resp.json()) as { enabled?: boolean }
      return data.enabled === true
    } catch {
      return false
    }
  }

  async setAnalyticsEnabled(enabled: boolean): Promise<{ success: boolean }> {
    try {
      const resp = await fetchWithAuth('/_web/telemetry/enabled', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      return (await resp.json()) as { success: boolean }
    } catch {
      return { success: false }
    }
  }

  async trackDailyActive(locale: string): Promise<void> {
    await fetchWithAuth('/_web/telemetry/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventName: 'app_active', properties: { platform: 'cli-web', locale } }),
    }).catch(() => {})
  }

  async showOpenDialog(_options: OpenDialogOptions): Promise<OpenDialogResult> {
    return { canceled: true, filePaths: [] }
  }

  async copyImageToClipboard(dataUrl: string): Promise<{ success: boolean; error?: string }> {
    if (globalThis.isSecureContext === false) {
      return { success: false, error: 'Image clipboard requires HTTPS or localhost' }
    }

    if (
      typeof navigator === 'undefined' ||
      typeof navigator.clipboard?.write !== 'function' ||
      typeof ClipboardItem === 'undefined'
    ) {
      return { success: false, error: 'Image clipboard is not supported by this browser' }
    }

    try {
      // Keep the Blob conversion inside ClipboardItem so the write starts within the user's click activation.
      const pngBlob = fetch(dataUrl).then(async (response) => {
        if (!response.ok) throw new Error(`Failed to read screenshot data: HTTP ${response.status}`)
        const blob = await response.blob()
        if (blob.type !== 'image/png') throw new Error(`Unsupported screenshot MIME type: ${blob.type || 'unknown'}`)
        return blob
      })

      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })])
      return { success: true }
    } catch (error) {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      reportError(`Image clipboard write failed: ${detail}`, error instanceof Error ? error.stack : undefined)
      return { success: false, error: detail }
    }
  }

  async checkUpdate(): Promise<CheckUpdateResult> {
    try {
      const resp = await fetchWithAuth('/_web/system/check-update')
      return await resp.json()
    } catch (err) {
      return {
        hasUpdate: false,
        currentVersion: 'unknown',
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  async performUpdate(): Promise<PerformUpdateResult> {
    return {
      success: false,
      error: 'Web update is unavailable. Run clb update in your terminal.',
    }
  }

  async relaunch(): Promise<void> {
    window.location.reload()
  }
}
