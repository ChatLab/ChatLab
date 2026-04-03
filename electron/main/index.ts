import { app, shell, BrowserWindow, protocol, nativeTheme } from 'electron'
import { join } from 'path'
import { optimizer, is, platform } from '@electron-toolkit/utils'
import { checkUpdate } from './update'
import mainIpcMain, { cleanup } from './ipcMain'
import { initAnalytics, trackDailyActive } from './analytics'
import { initProxy } from './network/proxy'
import { needsLegacyMigration, migrateFromLegacyDir, ensureAppDirs, cleanupPendingDeleteDir } from './paths'
import { migrateAllDatabases, checkMigrationNeeded } from './database/core'
import { initLocale } from './i18n'

type AppWithQuitFlag = typeof app & { isQuiting?: boolean }
// 统一通过扩展类型访问退出标记，避免使用 @ts-ignore。
const appWithQuitFlag = app as AppWithQuitFlag

class MainProcess {
  mainWindow: BrowserWindow | null
  isTestMode: boolean
  constructor() {
    // 主窗口
    this.mainWindow = null

    // E2E 测试模式检查：跳过遗留数据迁移和其他测试无关的初始化
    this.isTestMode = process.env.TEST_MODE === 'true'

    // E2E 测试隔离：为并行测试实例设置独立的用户数据目录
    // 这防止了并发进程的状态泄漏、死锁和数据库冲突
    const e2eUserDataDir = process.env.CHATLAB_E2E_USER_DATA_DIR
    if (e2eUserDataDir) {
      app.setPath('userData', e2eUserDataDir)
    }

    // 设置应用程序名称
    if (process.platform === 'win32') app.setAppUserModelId(app.getName())
    // 初始化
    this.checkApp().then(async (lockObtained) => {
      if (lockObtained) {
        await this.init()
      }
    })
  }

  // 单例锁
  async checkApp() {
    // E2E 测试模式：绕过单实例锁以支持并行实例
    const isTestMode = process.env.TEST_MODE === 'true'
    if (isTestMode) {
      return true
    }

    if (!app.requestSingleInstanceLock()) {
      app.quit()
      // 未获得锁
      return false
    }
    // 聚焦到当前程序
    else {
      app.on('second-instance', () => {
        if (this.mainWindow) {
          this.mainWindow.show()
          if (this.mainWindow.isMinimized()) this.mainWindow.restore()
          this.mainWindow.focus()
        }
      })
      // 获得锁
      return true
    }
  }

  // 初始化程序
  async init() {
    initAnalytics()

    // E2E 测试模式：跳过遗留数据迁移
    // 遗留迁移会删除 Documents/ChatLab，在本地测试时可能破坏用户数据
    if (!this.isTestMode) {
      // 清理上次切换目录后的旧数据目录
      cleanupPendingDeleteDir()

      // 执行数据目录迁移（从 Documents/ChatLab 迁移到 userData）
      this.migrateDataIfNeeded()
    }

    // 确保应用目录存在
    ensureAppDirs()

    // 初始化主进程国际化（在 ensureAppDirs 之后，确保 settings 目录存在）
    await initLocale()

    // 执行数据库 schema 迁移（确保所有数据库在 Worker 查询前已是最新 schema）
    this.migrateDatabasesIfNeeded()

    initProxy() // 初始化代理配置

    // 暂不注册自定义协议，避免触发系统 URL 协议关联提示

    // 应用程序准备好之前注册
    protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { secure: true, standard: true } }])

    // 主应用程序事件
    this.mainAppEvents()
  }

  // 从旧目录迁移数据（静默迁移）
  migrateDataIfNeeded() {
    if (needsLegacyMigration()) {
      console.log('[Main] Legacy data migration needed, starting migration...')
      const result = migrateFromLegacyDir()
      if (result.success) {
        console.log(`[Main] Migration completed. Migrated: ${result.migratedDirs.join(', ')}`)
      } else {
        console.error('[Main] Migration failed:', result.error)
      }
    } else {
      console.log('[Main] No legacy data migration needed')
    }
  }

  // 执行数据库 schema 迁移（静默迁移）
  migrateDatabasesIfNeeded() {
    try {
      const { count } = checkMigrationNeeded()
      if (count > 0) {
        const result = migrateAllDatabases()
        if (!result.success) {
          console.error('[Main] Database schema migration failed:', result.error)
        }
      }
    } catch (error) {
      console.error('[Main] Error in migrateDatabasesIfNeeded:', error)
    }
  }

  // 创建主窗口
  async createWindow() {
    // 平台差异化窗口配置
    const windowOptions: Electron.BrowserWindowConstructorOptions = {
      width: 1180,
      height: 752,
      minWidth: 1180,
      minHeight: 752,
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        devTools: true,
      },
    }

    // macOS: 使用 hiddenInset 保留红绿灯按钮
    // Windows: 使用 titleBarOverlay，在自定义标题栏区域右侧显示原生窗口按钮
    // Linux: 使用自定义标题栏和自定义按钮
    if (platform.isMacOS) {
      windowOptions.titleBarStyle = 'hiddenInset'
    } else if (platform.isWindows) {
      // 保留系统框架，只隐藏标题栏内容，把内容区域顶到最上方
      windowOptions.titleBarStyle = 'hidden'
      // 获取当前主题状态
      const isDark = nativeTheme.shouldUseDarkColors
      windowOptions.titleBarOverlay = {
        // 背景色与应用背景匹配，确保 hover 效果正确
        color: isDark ? '#111827' : '#f9fafb', // dark: gray-900, light: gray-50
        // 图标颜色适配主题
        symbolColor: isDark ? '#a1a1aa' : '#52525b', // dark: zinc-400, light: zinc-600
        height: 32,
      }
    } else {
      // Linux 继续使用无边框 + 自定义按钮
      windowOptions.frame = false
    }

    this.mainWindow = new BrowserWindow(windowOptions)

    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow?.show()

      // Windows 上根据当前主题设置 titleBarOverlay 颜色
      if (platform.isWindows) {
        const isDark = nativeTheme.shouldUseDarkColors
        this.mainWindow?.setTitleBarOverlay({
          color: isDark ? '#111827' : '#f9fafb', // dark: gray-900, light: gray-50
          symbolColor: isDark ? '#a1a1aa' : '#52525b', // dark: zinc-400, light: zinc-600
          height: 32,
        })

        // 监听主题变化，动态更新颜色
        nativeTheme.on('updated', () => {
          if (this.mainWindow && platform.isWindows) {
            const isDark = nativeTheme.shouldUseDarkColors
            this.mainWindow.setTitleBarOverlay({
              color: isDark ? '#111827' : '#f9fafb', // dark: gray-900, light: gray-50
              symbolColor: isDark ? '#a1a1aa' : '#52525b', // dark: zinc-400, light: zinc-600
              height: 32,
            })
          }
        })
      }
    })

    // 主窗口事件
    this.mainWindowEvents()

    this.mainWindow.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    // HMR for renderer base on electron-vite cli.
    // Load the remote URL for development or the local html file for production.
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      this.mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      this.mainWindow.loadFile(join(__dirname, '../../out/renderer/index.html'))
    }
  }

  // 主应用程序事件
  mainAppEvents() {
    app.whenReady().then(async () => {
      console.log('[Main] App is ready')
      // 设置Windows应用程序用户模型id
      if (process.platform === 'win32') app.setAppUserModelId(app.getName())

      // 记录日活（用于统计操作系统版本、客户端版本，便于更好的适配客户端）
      trackDailyActive()

      // 创建主窗口
      console.log('[Main] Creating window...')
      await this.createWindow()
      console.log('[Main] Window created')

      // 检查更新逻辑
      checkUpdate(this.mainWindow)

      // 引入主进程ipcMain
      if (this.mainWindow) {
        console.log('[Main] Registering IPC handlers...')
        mainIpcMain(this.mainWindow)
        console.log('[Main] IPC handlers registered')
      }

      // 开发环境下 F12 打开控制台
      app.on('browser-window-created', (_, window) => {
        optimizer.watchWindowShortcuts(window)
      })

      app.on('activate', () => {
        // 在 macOS 上，当单击 Dock 图标且没有其他窗口时，通常会重新创建窗口
        if (BrowserWindow.getAllWindows().length === 0) {
          this.createWindow()
          return
        }

        if (platform.isMacOS) {
          this.mainWindow?.show()
        }
      })

      // 监听渲染进程崩溃
      app.on('render-process-gone', (_event, w, d) => {
        if (d.reason == 'crashed') {
          w.reload()
        }
        // fs.appendFile(`./error-log-${+new Date()}.txt`, `${new Date()}渲染进程被杀死${d.reason}\n`)
      })

      // 自定义协议
      app.on('open-url', (_, url) => {
        console.log('Received custom protocol URL:', url)
      })

      // 当所有窗口都关闭时退出应用，macOS 除外
      app.on('window-all-closed', () => {
        if (!platform.isMacOS) {
          app.quit()
        }
      })

      // 只有显式调用quit才退出系统，区分MAC系统程序坞退出和点击X隐藏
      app.on('before-quit', () => {
        appWithQuitFlag.isQuiting = true
      })

      // 退出前清理资源
      app.on('will-quit', () => {
        cleanup()
      })
    })
  }

  // 主窗口事件
  mainWindowEvents() {
    if (!this.mainWindow) {
      return
    }
    this.mainWindow.webContents.on('did-finish-load', () => {
      setTimeout(() => {
        if (this.mainWindow) {
          this.mainWindow.webContents.send('app-started')
        }
      }, 500)
    })

    this.mainWindow.on('maximize', () => {
      this.mainWindow?.webContents.send('windowState', true)
    })

    this.mainWindow.on('unmaximize', () => {
      this.mainWindow?.webContents.send('windowState', false)
    })

    // 窗口关闭
    this.mainWindow.on('close', (event) => {
      if (platform.isMacOS) {
        // macOS: 只有明确退出时才真正关闭，否则只隐藏窗口（符合 macOS 用户习惯）
        if (!appWithQuitFlag.isQuiting) {
          event.preventDefault()
          this.mainWindow?.hide()
        }
      }
      // Windows/Linux: 不阻止关闭，正常触发 window-all-closed → app.quit() → cleanup()
    })
  }
}

// 捕获未捕获的异常
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error)
})

new MainProcess()
