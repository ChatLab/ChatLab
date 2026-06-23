/**
 * PlatformAdapter — 平台能力领域适配器接口
 *
 * 负责平台特定的能力：版本信息、主题、文件对话框、剪贴板、
 * 远程配置获取、开机自启、重启等。
 * 来源：window.api（Electron IPC）
 */

export interface OpenDialogOptions {
  title?: string
  defaultPath?: string
  filters?: Array<{ name: string; extensions: string[] }>
  properties?: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles' | 'createDirectory'>
}

export interface OpenDialogResult {
  canceled: boolean
  filePaths: string[]
}

export interface RemoteConfigResult {
  success: boolean
  data?: unknown
  error?: string
}

export interface CheckUpdateResult {
  hasUpdate: boolean
  currentVersion: string
  latestVersion?: string
  error?: string
}

export interface PerformUpdateResult {
  success: boolean
  error?: string
}

export interface PlatformAdapter {
  getVersion(): Promise<string>
  fetchRemoteConfig(url: string): Promise<RemoteConfigResult>

  setThemeSource(theme: 'system' | 'light' | 'dark'): void

  getOpenAtLogin(): Promise<boolean>
  setOpenAtLogin(enabled: boolean): Promise<{ success: boolean; error?: string }>

  getAnalyticsEnabled(): Promise<boolean>
  setAnalyticsEnabled(enabled: boolean): Promise<{ success: boolean }>
  trackDailyActive(locale: string): Promise<void>

  showOpenDialog(options: OpenDialogOptions): Promise<OpenDialogResult>
  copyImageToClipboard(dataUrl: string): Promise<{ success: boolean; error?: string }>

  checkUpdate(): Promise<CheckUpdateResult | void>
  performUpdate(): Promise<PerformUpdateResult>
  relaunch(): Promise<void>
}
