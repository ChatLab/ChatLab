import { app, BrowserWindow, Menu, Tray } from 'electron'
import { join } from 'path'
import { t } from '../i18n'

let tray: Tray | null = null
let targetWindow: BrowserWindow | null = null
let quitHandler: (() => void) | null = null

export function ensureWindowsTray(win: BrowserWindow, onQuit: () => void): void {
  targetWindow = win
  quitHandler = onQuit

  if (!tray) {
    tray = new Tray(resolveTrayIconPath())
    tray.setToolTip('ChatLab')
    tray.on('click', restoreMainWindow)
  }

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: t('windowClose.showApp'), click: restoreMainWindow },
      { type: 'separator' },
      { label: t('windowClose.quitApp'), click: () => quitHandler?.() },
    ])
  )
}

export function destroyWindowsTray(): void {
  tray?.destroy()
  tray = null
  targetWindow = null
  quitHandler = null
}

function restoreMainWindow(): void {
  if (!targetWindow || targetWindow.isDestroyed()) return
  if (targetWindow.isMinimized()) targetWindow.restore()
  targetWindow.show()
  targetWindow.focus()
}

function resolveTrayIconPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'tray-icon.ico') : join(__dirname, '../../build/icon.ico')
}
