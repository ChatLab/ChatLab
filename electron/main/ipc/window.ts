/**
 * 窗口和文件系统操作 IPC 处理器
 */

import { ipcMain, app, dialog, clipboard, shell, nativeTheme } from 'electron'
import * as fs from 'fs/promises'
import type { IpcContext } from './types'
import { simulateUpdateDialog, manualCheckForUpdates } from '../update'
import { t } from '../i18n'

type AppWithQuitFlag = typeof app & { isQuiting?: boolean }
// 通过类型扩展记录应用退出意图，避免使用 @ts-ignore。
const appWithQuitFlag = app as AppWithQuitFlag

const REMOTE_CONFIG_ALLOWED_DOMAINS = ['chatlab.fun', '1app.top']
const REMOTE_CONFIG_TIMEOUT_MS = 8000
const REMOTE_CONFIG_MAX_BYTES = 1024 * 1024 // 1MB

function isAllowedRemoteConfigUrl(rawUrl: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return false
  }

  if (parsed.protocol !== 'https:') return false
  if (parsed.username || parsed.password) return false
  if (parsed.port && parsed.port !== '443') return false

  const hostname = parsed.hostname.toLowerCase()
  return REMOTE_CONFIG_ALLOWED_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
}

/**
 * 注册窗口和文件系统操作 IPC 处理器
 */
export function registerWindowHandlers(ctx: IpcContext): void {
  const { win } = ctx

  // ==================== 窗口操作 ====================
  ipcMain.on('window-min', (ev) => {
    ev.preventDefault()
    win.minimize()
  })

  ipcMain.on('window-maxOrRestore', (ev) => {
    const winSizeState = win.isMaximized()
    if (winSizeState) {
      win.restore()
    } else {
      win.maximize()
    }
    ev.reply('windowState', win.isMaximized())
  })

  ipcMain.on('window-restore', () => {
    win.restore()
  })

  ipcMain.on('window-hide', () => {
    win.hide()
  })

  ipcMain.on('window-close', () => {
    win.close()
    appWithQuitFlag.isQuiting = true
    app.quit()
  })

  ipcMain.on('window-resize', (_, data) => {
    if (data.resize) {
      win.setResizable(true)
    } else {
      win.setSize(1180, 752)
      win.setResizable(false)
    }
  })

  ipcMain.on('open-devtools', () => {
    win.webContents.openDevTools()
  })

  // 设置主题模式
  ipcMain.on('window:setThemeSource', (_, mode: 'system' | 'light' | 'dark') => {
    nativeTheme.themeSource = mode

    // Windows 上动态更新 overlay 颜色以匹配主题
    if (process.platform === 'win32' && win) {
      const isDark = nativeTheme.shouldUseDarkColors
      win.setTitleBarOverlay({
        color: isDark ? '#111827' : '#f9fafb', // dark: gray-900, light: gray-50
        symbolColor: isDark ? '#a1a1aa' : '#52525b', // dark: zinc-400, light: zinc-600
        height: 32,
      })
    }
  })

  // ==================== 应用信息 ====================
  ipcMain.handle('app:getVersion', () => {
    return app.getVersion()
  })

  // 重启应用
  ipcMain.handle('app:relaunch', () => {
    app.relaunch()
    app.quit()
  })

  // 获取远程配置（支持 JSON 和纯文本/Markdown）
  ipcMain.handle('app:fetchRemoteConfig', async (_, url: string) => {
    const normalizedUrl = typeof url === 'string' ? url.trim() : ''
    if (!isAllowedRemoteConfigUrl(normalizedUrl)) {
      return { success: false, error: 'URL is not allowed' }
    }

    const abortController = new AbortController()
    const timeout = setTimeout(() => abortController.abort(), REMOTE_CONFIG_TIMEOUT_MS)

    try {
      // 使用 manual 重定向模式，手动验证每个重定向目标
      let currentUrl = normalizedUrl
      let response = await fetch(currentUrl, {
        signal: abortController.signal,
        redirect: 'manual',
      })

      // 处理重定向链（最多跟随3次重定向，避免无限循环）
      let redirectCount = 0
      const maxRedirects = 3

      while (response.status >= 300 && response.status < 400 && redirectCount < maxRedirects) {
        redirectCount++

        const location = response.headers.get('location')
        if (!location) {
          return { success: false, error: `Redirect response without location header (hop ${redirectCount})` }
        }

        // 构建完整的重定向 URL
        const redirectUrl = new URL(location, currentUrl).href
        if (!isAllowedRemoteConfigUrl(redirectUrl)) {
          return { success: false, error: `Redirect URL is not allowed (hop ${redirectCount}): ${redirectUrl}` }
        }

        // 跟随重定向
        currentUrl = redirectUrl
        response = await fetch(currentUrl, {
          signal: abortController.signal,
          redirect: 'manual',
        })
      }

      // 检查是否超过最大重定向次数（严格大于，允许恰好等于最大次数）
      if (redirectCount > maxRedirects) {
        return { success: false, error: `Too many redirects (exceeded ${maxRedirects})` }
      }

      // 验证最终响应的 URL
      const finalUrl = response.url || currentUrl
      if (!isAllowedRemoteConfigUrl(finalUrl)) {
        return { success: false, error: 'Final URL is not allowed' }
      }

      const contentType = response.headers.get('content-type') || ''
      const contentLength = Number(response.headers.get('content-length') || 0)

      if (Number.isFinite(contentLength) && contentLength > REMOTE_CONFIG_MAX_BYTES) {
        return { success: false, error: 'Response is too large' }
      }

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}: ${response.statusText}` }
      }

      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.length > REMOTE_CONFIG_MAX_BYTES) {
        return { success: false, error: 'Response is too large' }
      }

      // 根据 Content-Type 或 URL 后缀决定解析方式
      const isJson = contentType.includes('application/json') || finalUrl.endsWith('.json')

      if (isJson) {
        const data = JSON.parse(buffer.toString('utf-8'))
        return { success: true, data }
      } else {
        // 纯文本/Markdown 等其他格式
        const data = buffer.toString('utf-8')
        return { success: true, data }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { success: false, error: 'Request timeout' }
      }
      return { success: false, error: String(error) }
    } finally {
      clearTimeout(timeout)
    }
  })

  // ==================== 开机自启动 ====================
  ipcMain.handle('app:getOpenAtLogin', () => {
    if (!app.isPackaged) return false
    const { openAtLogin } = app.getLoginItemSettings()
    return openAtLogin
  })

  ipcMain.handle('app:setOpenAtLogin', (_, enabled: boolean) => {
    if (!app.isPackaged) return { success: false, error: 'Not available in dev mode' }
    try {
      app.setLoginItemSettings({ openAtLogin: enabled })
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // ==================== 更新检查 ====================
  ipcMain.on('check-update', () => {
    // 手动检查更新（即使是预发布版本也会提示）
    manualCheckForUpdates()
  })

  // 模拟更新弹窗（仅开发模式使用）
  ipcMain.on('simulate-update', () => {
    if (!app.isPackaged) {
      simulateUpdateDialog(win)
    }
  })

  // ==================== 通用工具 ====================
  ipcMain.handle('show-message', (event, args) => {
    event.sender.send('show-message', args)
  })

  // 复制到剪贴板（文本）
  ipcMain.handle('copyData', async (_, data) => {
    try {
      clipboard.writeText(data)
      return true
    } catch (error) {
      console.error('Copy operation error:', error)
      return false
    }
  })

  // 复制图片到剪贴板（base64 data URL）
  ipcMain.handle('copyImage', async (_, dataUrl: string) => {
    try {
      // 从 data URL 中提取 base64 数据
      const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '')
      const imageBuffer = Buffer.from(base64Data, 'base64')
      // 使用 nativeImage 创建图片并写入剪贴板
      const { nativeImage } = await import('electron')
      const image = nativeImage.createFromBuffer(imageBuffer)
      clipboard.writeImage(image)
      return { success: true }
    } catch (error) {
      console.error('Image copy error:', error)
      return { success: false, error: String(error) }
    }
  })

  // ==================== 文件系统操作 ====================
  // 选择文件夹
  ipcMain.handle('selectDir', async (_, defaultPath = '') => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: t('dialog.selectDirectory'),
        defaultPath: defaultPath || app.getPath('documents'),
        properties: ['openDirectory', 'createDirectory'],
        buttonLabel: t('dialog.selectFolder'),
      })
      if (!canceled) {
        return filePaths[0]
      }
      return null
    } catch (err) {
      console.error(t('dialog.selectFolderError'), err)
      throw err
    }
  })

  // 检查文件是否存在
  ipcMain.handle('checkFileExist', async (_, filePath) => {
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  })

  // 在文件管理器中打开
  ipcMain.handle('openInFolder', async (_, path) => {
    try {
      await fs.access(path)
      await shell.showItemInFolder(path)
      return true
    } catch (error) {
      console.error('Error opening directory:', error)
      return false
    }
  })

  // 显示打开对话框（通用）
  ipcMain.handle('dialog:showOpenDialog', async (_, options) => {
    try {
      return await dialog.showOpenDialog(options)
    } catch (error) {
      console.error('Failed to show dialog:', error)
      throw error
    }
  })
}
