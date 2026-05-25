/**
 * WebPlatformAdapter — Web 模式降级实现
 *
 * 大部分平台能力在 Web 模式下不可用，提供安全的降级行为。
 */

import type {
  PlatformAdapter,
  OpenDialogOptions,
  OpenDialogResult,
  RemoteConfigResult,
  CheckUpdateResult,
  PerformUpdateResult,
} from './types'

declare const __APP_VERSION__: string

export class WebPlatformAdapter implements PlatformAdapter {
  async getVersion(): Promise<string> {
    return typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'web'
  }

  async fetchRemoteConfig(url: string): Promise<RemoteConfigResult> {
    try {
      const res = await fetch(url)
      if (!res.ok) return { success: false, error: `HTTP ${res.status}` }
      const data = await res.json()
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
    return { success: false, error: 'Not available in web mode' }
  }

  async getAnalyticsEnabled(): Promise<boolean> {
    return false
  }

  async setAnalyticsEnabled(_enabled: boolean): Promise<{ success: boolean }> {
    return { success: false }
  }

  async showOpenDialog(_options: OpenDialogOptions): Promise<OpenDialogResult> {
    return { canceled: true, filePaths: [] }
  }

  async copyImageToClipboard(_dataUrl: string): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Not available in web mode' }
  }

  async checkUpdate(): Promise<CheckUpdateResult> {
    try {
      const resp = await fetch('/_web/system/check-update')
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
    try {
      const resp = await fetch('/_web/system/update', { method: 'POST' })
      return await resp.json()
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async relaunch(): Promise<void> {
    window.location.reload()
  }
}
