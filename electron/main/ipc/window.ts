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
    try {
      const response = await fetch(url)
      const contentType = response.headers.get('content-type') || ''

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}: ${response.statusText}` }
      }

      // 根据 Content-Type 或 URL 后缀决定解析方式
      const isJson = contentType.includes('application/json') || url.endsWith('.json')

      if (isJson) {
        const data = await response.json()
        return { success: true, data }
      } else {
        // 纯文本/Markdown 等其他格式
        const data = await response.text()
        return { success: true, data }
      }
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
