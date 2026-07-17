/**
 * 应用锁安全 API - 暴露给渲染进程
 *
 * 所有安全敏感操作通过 IPC 调用主进程执行。
 * 渲染进程不直接操作密码或加密密钥。
 */

import { ipcRenderer } from 'electron'

export interface LockConfig {
  enabled: boolean
  unlockMode: 'password' | 'windows-hello'
  idleTimeoutMinutes: number
  lockOnBlur: boolean
  lockOnStartup: boolean
  hasPassword: boolean
  windowsHelloAvailable: boolean
}

export interface WindowsHelloAvailability {
  available: boolean
  biometricConfigured: boolean
  pinConfigured: boolean
  consentVerified: boolean
  reason?: string
}

export interface UnlockResult {
  success: boolean
  needsSetup?: boolean
  wrongPassword?: boolean
  cooldown?: boolean
  cooldownRemaining?: number
  remainingRetries?: number
  windowsHelloUnavailable?: boolean
  cancelled?: boolean
  error?: string
}

export interface PasswordChangeResult {
  success: boolean
  error?: string
  strength?: 'weak' | 'medium' | 'strong'
}

export type { PasswordChangeResult as SetPasswordResult }

export const securityApi = {
  // ==================== 锁状态 ====================

  /** 获取锁配置 */
  getConfig: (): Promise<LockConfig> => {
    return ipcRenderer.invoke('app-lock:getConfig')
  },

  /** 获取当前锁状态 */
  getState: (): Promise<{ state: 'unlocked' | 'locked' | 'recovery-locked' | 'configuring' }> => {
    return ipcRenderer.invoke('app-lock:getState')
  },

  /** 检查 Windows Hello 可用性 */
  checkWindowsHello: (): Promise<WindowsHelloAvailability> => {
    return ipcRenderer.invoke('app-lock:checkWindowsHello')
  },

  /** 设置页绑定 Hello：唤起系统原生验证弹窗，返回 verified/cancelled/notAvailable */
  verifyHello: (message: string): Promise<{
    success: boolean; verified: boolean; cancelled: boolean; notAvailable: boolean; error?: string
  }> => {
    return ipcRenderer.invoke('app-lock:verifyHello', message)
  },

  /** 纯密码校验：仅比对哈希，不依赖锁屏解锁状态 */
  verifyAppPassword: (rawPassword: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('app-lock:verifyAppPassword', rawPassword)
  },

  /** 重新启用已关闭的锁（密码不变，仅恢复 enabled=true） */
  reEnableLock: (oldPassword: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('app-lock:reEnableLock', oldPassword)
  },

  /** 恢复模式：重置损坏配置，重新初始化应用锁 */
  recoveryReset: (): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('app-lock:recoveryReset')
  },

  // ==================== 锁操作 ====================

  /** 锁定应用（手动触发） */
  lock: (): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('app-lock:lock')
  },

  /** 解锁应用 */
  unlock: (credentials?: { password?: string; useWindowsHello?: boolean }): Promise<UnlockResult> => {
    return ipcRenderer.invoke('app-lock:unlock', credentials)
  },

  // ==================== 密码管理 ====================

  /** 设置密码（首次或重置后） */
  setPassword: (newPassword: string): Promise<PasswordChangeResult> => {
    return ipcRenderer.invoke('app-lock:setPassword', newPassword)
  },

  /** 修改密码 */
  changePassword: (oldPassword: string, newPassword: string): Promise<PasswordChangeResult> => {
    return ipcRenderer.invoke('app-lock:changePassword', oldPassword, newPassword)
  },

  /** 重置密码（清除锁定） */
  resetPassword: (): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('app-lock:resetPassword')
  },

  // ==================== 配置管理 ====================

  /** 更新锁配置 */
  updateConfig: (
    updates: Partial<{
      enabled: boolean
      unlockMode: 'password' | 'windows-hello'
      idleTimeoutMinutes: number
      lockOnBlur: boolean
      lockOnStartup: boolean
    }>
  ): Promise<{ success: boolean; config?: LockConfig; error?: string }> => {
    return ipcRenderer.invoke('app-lock:updateConfig', updates)
  },

  // ==================== 用户活动 ====================

  /** 报告用户活动（用于闲置检测） */
  reportActivity: (): void => {
    ipcRenderer.send('app-lock:reportActivity')
  },

  // ==================== 事件监听 ====================

  /** 监听锁状态变化 */
  onLockStateChanged: (callback: (data: { locked: boolean }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { locked: boolean }) => {
      callback(data)
    }
    ipcRenderer.on('app-lock-state-changed', handler)
    return () => {
      ipcRenderer.removeListener('app-lock-state-changed', handler)
    }
  },
}
