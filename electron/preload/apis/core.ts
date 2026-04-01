/**
 * 核心 API - 基础 IPC 通信和系统功能
 */
import { ipcRenderer } from 'electron'

// Custom APIs for renderer
export const api = {
  send: (channel: string, data?: unknown) => {
    // whitelist channels
    const validChannels = [
      'show-message',
      'check-update',
      'simulate-update',
      'get-gpu-acceleration',
      'set-gpu-acceleration',
      'save-gpu-acceleration',
      'window-close', // 用户协议拒绝时退出应用
    ]
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data)
    }
  },
  receive: (channel: string, func: (...args: unknown[]) => void) => {
    const validChannels = [
      'show-message',
      'chat:importProgress',
      'merge:parseProgress',
      'llm:streamChunk',
      'agent:streamChunk',
      'agent:complete',
    ]
    if (validChannels.includes(channel)) {
      // Deliberately strip event as it includes `sender`
      ipcRenderer.on(channel, (_event, ...args) => func(...args))
    }
  },
  removeListener: (channel: string, func: (...args: unknown[]) => void) => {
    ipcRenderer.removeListener(channel, func)
  },
  setThemeSource: (mode: 'system' | 'light' | 'dark') => {
    ipcRenderer.send('window:setThemeSource', mode)
  },
}

// 扩展 api，添加 dialog、clipboard 和应用功能
export const extendedApi = {
  ...api,
  dialog: {
    showOpenDialog: (options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> => {
      return ipcRenderer.invoke('dialog:showOpenDialog', options)
    },
  },
  clipboard: {
    /**
     * 复制图片到系统剪贴板
     * @param dataUrl 图片的 base64 data URL
     */
    copyImage: (dataUrl: string): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('copyImage', dataUrl)
    },
  },
  app: {
    /**
     * 获取应用版本号
     */
    getVersion: (): Promise<string> => {
      return ipcRenderer.invoke('app:getVersion')
    },
    /**
     * 检查更新
     */
    checkUpdate: (): void => {
      ipcRenderer.send('check-update')
    },
    /**
     * 模拟更新弹窗（仅开发模式）
     */
    simulateUpdate: (): void => {
      ipcRenderer.send('simulate-update')
    },
    /**
     * 获取远程配置（通过主进程请求，绕过 CORS）
     */
    fetchRemoteConfig: (url: string): Promise<{ success: boolean; data?: unknown; error?: string }> => {
      return ipcRenderer.invoke('app:fetchRemoteConfig', url)
    },
    /**
     * 获取匿名统计开关状态
     */
    getAnalyticsEnabled: (): Promise<boolean> => {
      return ipcRenderer.invoke('analytics:getEnabled')
    },
    /**
     * 设置匿名统计开关状态
     */
    setAnalyticsEnabled: (enabled: boolean): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('analytics:setEnabled', enabled)
    },
    /**
     * 重启应用
     */
    relaunch: (): Promise<void> => {
      return ipcRenderer.invoke('app:relaunch')
    },
  },
}
