import { app, BrowserWindow, protocol, dialog } from 'electron'
import { join } from 'path'
import { optimizer, platform } from '@electron-toolkit/utils'
import { checkUpdate } from './update'
import mainIpcMain, { cleanup } from './ipc'
import { startInternalServer, stopInternalServer, registerInternalApiIpc } from './internal-api'
import { getPathProvider } from './paths/provider'
import { initAnalytics } from './analytics'
import { logger } from './logger'
import { prepareDesktopRuntime } from './app/bootstrap'
import { createMainWindow, markAppQuitting } from './window/main-window'

class MainProcess {
  mainWindow: BrowserWindow | null
  isTestMode: boolean

  constructor() {
    this.mainWindow = null
    this.isTestMode = process.env.TEST_MODE === 'true'

    // Isolate E2E instances to avoid sharing state, locks, and databases.
    const e2eUserDataDir = process.env.CHATLAB_E2E_USER_DATA_DIR
    if (this.isTestMode && e2eUserDataDir) {
      app.setPath('userData', e2eUserDataDir)
    } else if (!this.isTestMode && e2eUserDataDir) {
      console.warn('[Main] Ignored CHATLAB_E2E_USER_DATA_DIR because TEST_MODE is not enabled')
    }

    if (process.platform === 'win32') app.setAppUserModelId(app.getName())
    this.checkApp().then(async (lockObtained) => {
      if (lockObtained) {
        await this.init()
      }
    })
  }

  async checkApp(): Promise<boolean> {
    if (this.isTestMode) {
      return true
    }

    if (!app.requestSingleInstanceLock()) {
      app.quit()
      return false
    }

    app.on('second-instance', () => {
      if (this.mainWindow) {
        this.mainWindow.show()
        if (this.mainWindow.isMinimized()) this.mainWindow.restore()
        this.mainWindow.focus()
      }
    })
    return true
  }

  async init(): Promise<void> {
    initAnalytics()
    logger.info('Desktop app starting')

    if (!(await prepareDesktopRuntime(this.isTestMode))) {
      return
    }

    protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { secure: true, standard: true } }])
    this.registerAppEvents()
  }

  async createWindow(): Promise<void> {
    this.mainWindow = await createMainWindow({
      preloadPath: join(__dirname, '../preload/index.js'),
      rendererHtmlPath: join(__dirname, '../../out/renderer/index.html'),
    })
  }

  registerAppEvents(): void {
    app.whenReady().then(async () => {
      console.log('[Main] App is ready')
      if (process.platform === 'win32') app.setAppUserModelId(app.getName())

      try {
        await startInternalServer(getPathProvider())
        registerInternalApiIpc()
        console.log('[Main] Internal API Server ready')
      } catch (error) {
        console.error('[Main] Internal API Server failed to start:', error)
        dialog.showErrorBox(
          'ChatLab Internal Server Error',
          `Internal API Server failed to start. The application cannot continue.\n\n${
            error instanceof Error ? error.message : String(error)
          }`
        )
        app.quit()
        return
      }

      console.log('[Main] Creating window...')
      await this.createWindow()
      console.log('[Main] Window created')

      checkUpdate(this.mainWindow)

      if (this.mainWindow) {
        console.log('[Main] Registering IPC handlers...')
        mainIpcMain(this.mainWindow)
        console.log('[Main] IPC handlers registered')
      }

      app.on('browser-window-created', (_, window) => {
        optimizer.watchWindowShortcuts(window)
      })

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          void this.createWindow()
          return
        }

        if (platform.isMacOS) {
          this.mainWindow?.show()
        }
      })

      app.on('render-process-gone', (_event, webContents, details) => {
        if (details.reason === 'crashed') {
          webContents.reload()
        }
      })

      app.on('open-url', (_, url) => {
        console.log('Received custom protocol URL:', url)
      })

      app.on('window-all-closed', () => {
        if (!platform.isMacOS) {
          app.quit()
        }
      })

      app.on('before-quit', () => {
        markAppQuitting()
      })

      app.on('will-quit', () => {
        stopInternalServer().catch(() => {})
        cleanup()
      })
    })
  }
}

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error)
  logger.error(
    `Uncaught Exception: ${error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)}`
  )
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason)
  logger.error(
    `Unhandled Rejection: ${reason instanceof Error ? `${reason.message}\n${reason.stack ?? ''}` : String(reason)}`
  )
  process.exit(1)
})

new MainProcess()
