import { app, shell, BrowserWindow, nativeTheme } from 'electron'
import { is, platform } from '@electron-toolkit/utils'
import { applyCurrentTitleBarOverlay, getTitleBarOverlayOptions, resetCurrentTitleBarOverlayColor } from './titlebar'

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

function registerMainWindowEvents(win: BrowserWindow): void {
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

  win.on('close', (event) => {
    if (platform.isMacOS && !appWithQuitFlag.isQuiting) {
      event.preventDefault()
      currentMainWindow?.hide()
    }
  })
}
