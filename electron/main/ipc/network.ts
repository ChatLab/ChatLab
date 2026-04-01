/**
 * 网络设置 IPC 处理器
 * 处理代理配置的读取、保存和测试
 */

import { ipcMain } from 'electron'
import type { IpcContext } from './types'
import {
  loadProxyConfig,
  saveProxyConfig,
  testProxyConnection,
  validateProxyUrl,
  type ProxyConfig,
} from '../network/proxy'

/**
 * 注册网络设置相关的 IPC 处理器
 */
export function registerNetworkHandlers(_context: IpcContext): void {
  console.log('[IpcMain] Registering network handlers...')

  /**
   * 获取代理配置
   */
  ipcMain.handle('network:getProxyConfig', (): ProxyConfig => {
    return loadProxyConfig()
  })

  /**
   * 保存代理配置
   */
  ipcMain.handle('network:saveProxyConfig', (_event, config: ProxyConfig): { success: boolean; error?: string } => {
    try {
      // 如果是手动模式且填写了 URL，验证 URL 格式
      if (config.mode === 'manual' && config.url) {
        const validation = validateProxyUrl(config.url)
        if (!validation.valid) {
          return { success: false, error: validation.error }
        }
      }

      saveProxyConfig(config)
      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: `保存配置失败: ${errorMessage}` }
    }
  })

  /**
   * 测试代理连接
   */
  ipcMain.handle(
    'network:testProxyConnection',
    async (_event, proxyUrl: string): Promise<{ success: boolean; error?: string }> => {
      return testProxyConnection(proxyUrl)
    }
  )

  console.log('[IpcMain] Network handlers registered')
}
