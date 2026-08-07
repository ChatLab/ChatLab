import { app, shell, BrowserWindow, nativeTheme, dialog } from 'electron'
import { is, platform } from '@electron-toolkit/utils'
import { loadConfig, setConfigField } from '@openchatlab/config'
import { applyCurrentTitleBarOverlay, getTitleBarOverlayOptions, resetCurrentTitleBarOverlayColor } from './titlebar'
import { WindowsCloseController } from './close-behavior'
import { ensureWindowsTray } from './windows-tray'
import { t } from '../i18n'
import { logger } from '../logger'

type AppWithQuitFlag = typeof app & { isQuiting?: boolean }

const appWithQuitFlag = app as AppWithQuitFlag
let currentMainWindow: BrowserWindow | null = null

export interface MainWindowPaths {
  preloadPath: string
  rendererHtmlPath: string
}

export async function createMainWindow(paths: MainWindowPaths): Promise<BrowserWindow> {
  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1180,
    height: 752,
    minWidth: 1180,
    minHeight: 752,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: paths.preloadPath,
      sandbox: false,
      devTools: true,
    },
  }

  if (platform.isMacOS) {
    windowOptions.titleBarStyle = 'hiddenInset'
  } else if (platform.isWindows) {
    windowOptions.titleBarStyle = 'hidden'
    const isDark = nativeTheme.shouldUseDarkColors
    windowOptions.titleBarOverlay = getTitleBarOverlayOptions(isDark)
    windowOptions.backgroundColor = isDark ? '#111827' : '#f9fafb'
  } else {
    windowOptions.frame = false
  }

  const win = new BrowserWindow(windowOptions)
  currentMainWindow = win

  win.once('ready-to-show', () => {
    currentMainWindow?.show()

    if (platform.isWindows) {
      applyCurrentTitleBarOverlay(currentMainWindow, nativeTheme.shouldUseDarkColors)
      nativeTheme.on('updated', () => {
        if (currentMainWindow && platform.isWindows) {
          resetCurrentTitleBarOverlayColor()
          applyCurrentTitleBarOverlay(currentMainWindow, nativeTheme.shouldUseDarkColors)
        }
      })
    }
  })

  registerMainWindowEvents(win)

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(paths.rendererHtmlPath)
  }

  return win
}

export function markAppQuitting(): void {
  appWithQuitFlag.isQuiting = true
}

export function requestAppQuit(): void {
  markAppQuitting()
  app.quit()
}

function createWindowsCloseController(win: BrowserWindow): WindowsCloseController {
  return new WindowsCloseController({
    readPreference: () => loadConfig().desktop.close_behavior,
    savePreference: (preference) => {
      setConfigField('desktop.close_behavior', preference)
    },
    prompt: async () => {
      const result = await dialog.showMessageBox(win, {
        type: 'question',
        title: t('windowClose.title'),
        message: t('windowClose.message'),
        detail: t('windowClose.detail'),
        buttons: [t('windowClose.background'), t('windowClose.quitApp'), t('windowClose.cancel')],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
        checkboxLabel: t('windowClose.remember'),
        checkboxChecked: false,
      })

      return {
        action: result.response === 0 ? 'background' : result.response === 1 ? 'quit' : 'cancel',
        remember: result.checkboxChecked,
      }
    },
    enterBackground: () => {
      ensureWindowsTray(win, requestAppQuit)
      win.hide()
    },
    quit: requestAppQuit,
    onError: (error) => {
      logger.error(`Failed to handle Windows close request: ${error instanceof Error ? error.message : String(error)}`)
    },
  })
}

function registerMainWindowEvents(win: BrowserWindow): void {
  const windowsCloseController = platform.isWindows ? createWindowsCloseController(win) : null

  win.webContents.on('did-finish-load', () => {
    setTimeout(() => {
      currentMainWindow?.webContents.send('app-started')
    }, 500)
  })

  win.on('maximize', () => {
    currentMainWindow?.webContents.send('windowState', true)
  })

  win.on('unmaximize', () => {
    currentMainWindow?.webContents.send('windowState', false)
  })

  // Windows does not emit app.before-quit during system shutdown or restart.
  // session-end only fires once the session can no longer be cancelled.
  win.on('session-end', () => {
    markAppQuitting()
  })

  win.on('close', (event) => {
    if (platform.isMacOS && !appWithQuitFlag.isQuiting) {
      event.preventDefault()
      currentMainWindow?.hide()
      return
    }

    if (platform.isWindows && !appWithQuitFlag.isQuiting) {
      event.preventDefault()
      void windowsCloseController?.requestClose()
    }
  })
}
