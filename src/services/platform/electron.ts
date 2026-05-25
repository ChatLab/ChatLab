/**
 * ElectronPlatformAdapter — wrap window.api
 */

import type { PlatformAdapter, OpenDialogOptions, OpenDialogResult, RemoteConfigResult } from './types'

export class ElectronPlatformAdapter implements PlatformAdapter {
  getVersion(): Promise<string> {
    return window.api.app.getVersion()
  }

  fetchRemoteConfig(url: string): Promise<RemoteConfigResult> {
    return window.api.app.fetchRemoteConfig(url)
  }

  setThemeSource(theme: 'system' | 'light' | 'dark'): void {
    window.api.setThemeSource(theme)
  }

  getOpenAtLogin(): Promise<boolean> {
    return window.api.app.getOpenAtLogin()
  }

  setOpenAtLogin(enabled: boolean): Promise<{ success: boolean; error?: string }> {
    return window.api.app.setOpenAtLogin(enabled)
  }

  getAnalyticsEnabled(): Promise<boolean> {
    return window.api.app.getAnalyticsEnabled()
  }

  setAnalyticsEnabled(enabled: boolean): Promise<{ success: boolean }> {
    return window.api.app.setAnalyticsEnabled(enabled)
  }

  showOpenDialog(options: OpenDialogOptions): Promise<OpenDialogResult> {
    return window.api.dialog.showOpenDialog(options as Electron.OpenDialogOptions)
  }

  copyImageToClipboard(dataUrl: string): Promise<{ success: boolean; error?: string }> {
    return window.api.clipboard.copyImage(dataUrl)
  }

  async checkUpdate(): Promise<void> {
    window.api.app.checkUpdate()
  }

  async performUpdate(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Use built-in updater' }
  }

  relaunch(): Promise<void> {
    return window.api.app.relaunch()
  }
}
