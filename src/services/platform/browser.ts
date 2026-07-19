import type {
  CheckUpdateResult,
  OpenDialogOptions,
  OpenDialogResult,
  PerformUpdateResult,
  PlatformAdapter,
  RemoteConfigResult,
} from './types'

declare const __APP_VERSION__: string

export class BrowserPlatformAdapter implements PlatformAdapter {
  constructor(private readonly version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'web-wasm') {}

  async getVersion(): Promise<string> {
    return this.version
  }

  async fetchRemoteConfig(url: string): Promise<RemoteConfigResult> {
    try {
      const response = await fetch(url)
      if (!response.ok) return { success: false, error: `HTTP ${response.status}` }
      const contentType = response.headers.get('content-type') ?? ''
      const data = contentType.includes('application/json') ? await response.json() : await response.text()
      return { success: true, data }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  setThemeSource(theme: 'system' | 'light' | 'dark'): void {
    void theme
  }

  async getOpenAtLogin(): Promise<boolean> {
    return false
  }

  async setOpenAtLogin(_enabled: boolean): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Open at login is not available in Web WASM' }
  }

  async getAnalyticsEnabled(): Promise<boolean> {
    return false
  }

  async setAnalyticsEnabled(_enabled: boolean): Promise<{ success: boolean }> {
    return { success: false }
  }

  async trackDailyActive(locale: string): Promise<void> {
    void locale
  }

  async showOpenDialog(_options: OpenDialogOptions): Promise<OpenDialogResult> {
    return { canceled: true, filePaths: [] }
  }

  async copyImageToClipboard(_dataUrl: string): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Image clipboard is not available in Web WASM yet' }
  }

  async checkUpdate(): Promise<CheckUpdateResult> {
    return { hasUpdate: false, currentVersion: this.version }
  }

  async performUpdate(): Promise<PerformUpdateResult> {
    return { success: false, error: 'Updates are provided by the Web WASM deployment' }
  }

  async relaunch(): Promise<void> {
    window.location.reload()
  }
}
