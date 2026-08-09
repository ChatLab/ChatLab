/**
 * IPC 处理器共享类型
 */

import type { BrowserWindow } from 'electron'

/**
 * IPC 处理器注册上下文
 */
export interface IpcContext {
  /** 主窗口 */
  win: BrowserWindow
}
