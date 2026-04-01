/**
 * 代理配置管理模块
 * 提供 HTTP/HTTPS 代理的配置存储、读取和连接测试
 */

import * as fs from 'fs'
import * as path from 'path'
import { app, session } from 'electron'
import { getSettingsDir } from '../paths'

// 代理模式
export type ProxyMode = 'off' | 'system' | 'manual'

// 代理配置接口
export interface ProxyConfig {
  mode: ProxyMode // 代理模式：关闭、跟随系统、手动配置
  url: string // 完整的代理 URL，如 http://127.0.0.1:7890（仅 manual 模式使用）
}

// 默认配置 - 默认跟随系统
const DEFAULT_CONFIG: ProxyConfig = {
  mode: 'system',
  url: '',
}

// 配置文件路径
let CONFIG_PATH: string | null = null

function getConfigPath(): string {
  if (CONFIG_PATH) return CONFIG_PATH
  CONFIG_PATH = path.join(getSettingsDir(), 'proxy.json')
  return CONFIG_PATH
}

/**
 * 迁移旧版配置到新版
 * 旧版: { enabled: boolean, url: string }
 * 新版: { mode: ProxyMode, url: string }
 */
function migrateOldConfig(data: Record<string, unknown>): ProxyConfig {
  // 如果是旧版配置（有 enabled 字段，没有 mode 字段）
  if ('enabled' in data && !('mode' in data)) {
    const enabled = Boolean(data.enabled)
    const url = String(data.url || '')
    return {
      mode: enabled && url ? 'manual' : 'system', // 旧版关闭的改为跟随系统
      url: url,
    }
  }
  // 新版配置
  const mode = data.mode as ProxyMode
  if (!['off', 'system', 'manual'].includes(mode)) {
    return { ...DEFAULT_CONFIG }
  }
  return {
    mode: mode,
    url: String(data.url || ''),
  }
}

/**
 * 加载代理配置
 */
export function loadProxyConfig(): ProxyConfig {
  const configPath = getConfigPath()

  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG }
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8')
    const data = JSON.parse(content)
    return migrateOldConfig(data)
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

/**
 * 保存代理配置
 */
export function saveProxyConfig(config: ProxyConfig): void {
  const configPath = getConfigPath()
  const dir = path.dirname(configPath)

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')

  // 保存后立即应用代理设置到 Electron session
  applyProxyToSession()
}

/**
 * 验证代理 URL 格式
 */
export function validateProxyUrl(url: string): { valid: boolean; error?: string } {
  if (!url) {
    return { valid: false, error: '代理地址不能为空' }
  }

  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { valid: false, error: '仅支持 http:// 或 https:// 协议' }
    }
    if (!parsed.hostname) {
      return { valid: false, error: '代理地址格式无效' }
    }
    return { valid: true }
  } catch {
    return { valid: false, error: '代理地址格式无效，请使用 http://host:port 格式' }
  }
}

/**
 * 将代理设置应用到 Electron session
 * 这会影响所有通过 Electron 发起的网络请求（包括主进程的 fetch）
 */
export async function applyProxyToSession(): Promise<void> {
  const config = loadProxyConfig()

  try {
    switch (config.mode) {
      case 'off':
        // 直接连接，不使用代理
        await session.defaultSession.setProxy({
          mode: 'direct',
        })
        console.log('[Proxy] Proxy disabled (direct connection)')
        break

      case 'system':
        // 使用系统代理设置
        await session.defaultSession.setProxy({
          mode: 'system',
        })
        console.log('[Proxy] Using system proxy')
        break

      case 'manual':
        // 手动配置代理
        if (config.url) {
          const validation = validateProxyUrl(config.url)
          if (validation.valid) {
            await session.defaultSession.setProxy({
              proxyRules: config.url,
            })
            console.log(`[Proxy] Manual proxy enabled: ${config.url}`)
          } else {
            // URL 无效，回退到系统代理
            await session.defaultSession.setProxy({
              mode: 'system',
            })
            console.log('[Proxy] Invalid manual proxy URL, falling back to system proxy')
          }
        } else {
          // 没有填写 URL，回退到系统代理
          await session.defaultSession.setProxy({
            mode: 'system',
          })
          console.log('[Proxy] Manual proxy URL not configured, falling back to system proxy')
        }
        break

      default:
        // 未知模式，使用系统代理
        await session.defaultSession.setProxy({
          mode: 'system',
        })
        console.log('[Proxy] Unknown proxy mode, using system proxy')
    }
  } catch (error) {
    console.error('[Proxy] Failed to set proxy:', error)
  }
}

/**
 * 测试代理连接
 * 通过代理请求一个可靠的 HTTPS 地址来验证代理是否可用
 */
export async function testProxyConnection(proxyUrl: string): Promise<{ success: boolean; error?: string }> {
  // 先验证格式
  const validation = validateProxyUrl(proxyUrl)
  if (!validation.valid) {
    return { success: false, error: validation.error }
  }

  // 测试 URL 列表（按优先级）
  const testUrls = ['https://www.google.com', 'https://www.cloudflare.com', 'https://api.deepseek.com']

  try {
    // 临时设置代理
    await session.defaultSession.setProxy({
      proxyRules: proxyUrl,
    })

    // 使用 Electron 的 net 模块测试连接
    const { net } = await import('electron')

    let lastError: string = ''

    for (const testUrl of testUrls) {
      try {
        const result = await new Promise<{ success: boolean; error?: string }>((resolve) => {
          const request = net.request({
            method: 'HEAD',
            url: testUrl,
          })

          const timeout = setTimeout(() => {
            request.abort()
            resolve({ success: false, error: '连接超时' })
          }, 10000)

          request.on('response', (response) => {
            clearTimeout(timeout)
            // 任何响应都说明代理可用
            if (response.statusCode < 500) {
              resolve({ success: true })
            } else {
              resolve({ success: false, error: `HTTP ${response.statusCode}` })
            }
          })

          request.on('error', (error) => {
            clearTimeout(timeout)
            resolve({ success: false, error: error.message })
          })

          request.end()
        })

        if (result.success) {
          // 恢复之前的代理设置
          await applyProxyToSession()
          return { success: true }
        }

        lastError = result.error || ''
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e)
      }
    }

    // 恢复之前的代理设置
    await applyProxyToSession()
    return { success: false, error: lastError || '无法通过代理连接到测试服务器' }
  } catch (error) {
    // 恢复之前的代理设置
    await applyProxyToSession()

    const errorMessage = error instanceof Error ? error.message : String(error)

    // 友好的错误提示
    if (errorMessage.includes('ECONNREFUSED')) {
      return { success: false, error: '连接被拒绝，请检查代理服务器是否运行中' }
    }
    if (errorMessage.includes('ETIMEDOUT') || errorMessage.includes('timeout')) {
      return { success: false, error: '连接超时，请检查代理地址和端口' }
    }
    if (errorMessage.includes('ENOTFOUND')) {
      return { success: false, error: '无法解析代理服务器地址' }
    }

    return { success: false, error: `代理连接失败: ${errorMessage}` }
  }
}

/**
 * 获取当前有效的代理 URL
 * 仅在手动模式且 URL 有效时返回代理 URL，否则返回 undefined
 */
export function getActiveProxyUrl(): string | undefined {
  const config = loadProxyConfig()
  if (config.mode === 'manual' && config.url) {
    const validation = validateProxyUrl(config.url)
    if (validation.valid) {
      return config.url
    }
  }
  return undefined
}

/**
 * 初始化代理模块
 * 应用启动时调用，加载并应用代理配置
 */
export function initProxy(): void {
  // 延迟执行，确保 app ready
  if (app.isReady()) {
    applyProxyToSession()
  } else {
    app.whenReady().then(() => {
      applyProxyToSession()
    })
  }
}
