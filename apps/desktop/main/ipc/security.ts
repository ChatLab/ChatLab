/**
 * 应用锁安全模块 IPC 处理器
 *
 * 将 lock-manager 的功能通过 IPC 暴露给渲染进程。
 * 所有安全敏感操作在主进程执行，渲染进程仅发送请求。
 */

import { ipcMain } from 'electron'
import type { IpcContext } from './types'
import {
  lockApp,
  unlockApp,
  setPassword,
  changePassword,
  resetAppLockPassword,
  reEnableLock,
  recoveryResetLock,
  getLockConfig,
  getLockConfigAsync,
  getLockState,
  getWindowsHelloStatus,
  verifyAppPassword,
  verifyHelloForEnroll,
  updateLockConfig,
  reportUserActivity,
  type LockConfig,
} from '../security/lock-manager'
import { logger } from '../logger'

/**
 * 注册应用锁相关 IPC 处理器
 */
export function registerSecurityHandlers(_ctx: IpcContext): void {
  // ==================== 锁状态查询 ====================

  /**
   * 获取锁配置和状态
   */
  ipcMain.handle('app-lock:getConfig', async () => {
    try {
      return await getLockConfigAsync()
    } catch (error) {
      logger.error(`IPC app-lock:getConfig failed: ${error}`)
      return getLockConfig()
    }
  })

  /**
   * 获取当前锁状态
   */
  ipcMain.handle('app-lock:getState', () => {
    return { state: getLockState() }
  })

  /**
   * 检查 Windows Hello 可用性
   */
  ipcMain.handle('app-lock:checkWindowsHello', async () => {
    try {
      return await getWindowsHelloStatus()
    } catch (error) {
      logger.error(`IPC app-lock:checkWindowsHello failed: ${error}`)
      return { available: false }
    }
  })

  // ==================== 锁操作 ====================

  /**
   * 锁定应用
   */
  ipcMain.handle('app-lock:lock', () => {
    try {
      lockApp()
      return { success: true }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      logger.error(`IPC app-lock:lock failed: ${errMsg}`)
      return { success: false, error: errMsg }
    }
  })

  /**
   * 解锁应用
   */
  ipcMain.handle('app-lock:unlock', async (_event, credentials?: { password?: string; useWindowsHello?: boolean }) => {
    try {
      const result = await unlockApp(credentials)

      // 内存安全：credential 对象在 IPC 序列化/反序列化后由 V8 GC 处理，
      // 密码字段仅在主进程瞬间存在，不会被持久化。
      return result
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      // 日志脱敏：不记录密码内容
      logger.error(`IPC app-lock:unlock failed: ${errMsg}`)
      return { success: false, error: '解锁失败' }
    }
  })

  // ==================== 密码管理 ====================

  /**
   * 设置密码（首次或重置后）
   */
  ipcMain.handle('app-lock:setPassword', (_event, newPassword: string, enableLock?: boolean) => {
    try {
      if (typeof newPassword !== 'string') {
        return { success: false, error: '参数错误' }
      }
      const result = setPassword(newPassword, enableLock ?? false)
      return result
    } catch {
      logger.error(`IPC app-lock:setPassword failed`)
      return { success: false, error: '密码设置失败' }
    }
  })

  /**
   * 修改密码
   */
  ipcMain.handle('app-lock:changePassword', (_event, oldPassword: string, newPassword: string) => {
    try {
      if (typeof oldPassword !== 'string' || typeof newPassword !== 'string') {
        return { success: false, error: '参数错误' }
      }
      const result = changePassword(oldPassword, newPassword)
      return result
    } catch {
      logger.error(`IPC app-lock:changePassword failed`)
      return { success: false, error: '密码修改失败' }
    }
  })

  /**
   * 重置密码（清除锁定，仅在已解锁状态下可用）
   */
  ipcMain.handle('app-lock:resetPassword', () => {
    try {
      // 安全校验：仅在未锁定状态下允许重置
      if (getLockState() === 'locked') {
        return { success: false, error: '请先解锁应用' }
      }
      const result = resetAppLockPassword()
      return result
    } catch {
      logger.error(`IPC app-lock:resetPassword failed`)
      return { success: false, error: '重置密码失败' }
    }
  })

  // ==================== 配置管理 ====================

  /**
   * 更新锁配置
   */
  ipcMain.handle('app-lock:updateConfig', async (_event, updates: Partial<LockConfig>) => {
    try {
      const result = await updateLockConfig(updates)
      return result
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      logger.error(`IPC app-lock:updateConfig failed: ${errMsg}`)
      return { success: false, error: '更新配置失败' }
    }
  })

  // ==================== 活动报告（闲置检测） ====================

  /**
   * 报告用户活动（鼠标、键盘事件）
   * 由渲染进程定期或按事件调用，重置闲置计时器
   */
  ipcMain.on('app-lock:reportActivity', () => {
    reportUserActivity()
  })

  // ==================== 锁屏窗口事件 ====================

  /**
   * 锁屏窗口请求解锁
   */
  ipcMain.handle('app-lock:requestUnlock', async (_event, credentials?: { password?: string; useWindowsHello?: boolean }) => {
    try {
      return await unlockApp(credentials)
    } catch {
      logger.error(`IPC app-lock:requestUnlock failed`)
      return { success: false, error: '解锁失败' }
    }
  })

  // ==================== 恢复模式 ====================

  ipcMain.handle('app-lock:recoveryReset', () => {
    try {
      return recoveryResetLock()
    } catch {
      return { success: false, error: '操作失败' }
    }
  })

  // ==================== 重新启用锁 ====================

  ipcMain.handle('app-lock:reEnableLock', (_event, oldPassword: string) => {
    try {
      return reEnableLock(oldPassword)
    } catch {
      return { success: false, error: '操作失败' }
    }
  })

  // ==================== 纯密码校验 ====================

  /**
   * 纯密码校验：仅比对哈希，不依赖锁屏解锁状态。
   * 用于 Windows Hello 开户等场景，无论软件是否解锁都完整校验密码。
   */
  ipcMain.handle('app-lock:verifyAppPassword', (_event, rawPassword: string) => {
    try {
      return verifyAppPassword(rawPassword)
    } catch {
      return { success: false, error: '验证失败' }
    }
  })

  // ==================== Windows Hello 绑定 ====================

  /**
   * 设置页绑定 Hello：先由前端校验应用密码，通过后调用此接口唤起系统原生验证。
   * 返回三种明确状态：verified / cancelled / notAvailable，前端分别处理。
   */
  ipcMain.handle('app-lock:verifyHello', async (_event, message: string) => {
    try {
      const result = await verifyHelloForEnroll(message || '请验证您的身份以开启 Windows Hello')
      return result
    } catch (error) {
      logger.error(`IPC app-lock:verifyHello exception: ${error instanceof Error ? error.message : String(error)}`)
      return { success: false, verified: false, cancelled: false, notAvailable: false, error: '验证服务异常' }
    }
  })
}
