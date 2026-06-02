/**
 * Cache IPC handlers — IPC-only subset
 *
 * Most cache operations (getInfo, clear, openDir, saveToDownloads, etc.)
 * have been migrated to HTTP shared routes (packages/http-routes).
 * Only selectDataDir and setDataDir remain on IPC because they require
 * native Electron dialogs (showOpenDialog) and app-level config mutations.
 */
import { ipcMain, dialog, app } from 'electron'
import type { IpcContext } from './types'
import { getUserDataDir, setCustomDataDir, ensureAppDirs } from '../paths'
import { isInsideAppInstallDir } from '../utils/pathUtils'

export function registerCacheHandlers(_context: IpcContext): void {
  console.log('[IPC] Registering cache handlers (IPC-only subset)...')

  ipcMain.handle('cache:selectDataDir', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: getUserDataDir(),
        title: '选择数据目录',
        buttonLabel: '选择',
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false }
      }

      const selectedPath = result.filePaths[0]

      try {
        const exePath = app.getPath('exe')
        if (isInsideAppInstallDir(selectedPath, exePath)) {
          return { success: false, error: 'INSTALL_DIR_FORBIDDEN' }
        }
      } catch {
        // exe path unavailable, skip check
      }

      return { success: true, path: selectedPath }
    } catch (error) {
      console.error('[Cache] Error selecting data dir:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('cache:setDataDir', async (_, payload: { path?: string | null; migrate?: boolean }) => {
    const targetPath = typeof payload?.path === 'string' ? payload.path : null
    const migrate = payload?.migrate !== false

    const result = setCustomDataDir(targetPath, migrate)
    if (!result.success) {
      return { success: false, error: result.error }
    }

    if (result.requiresRelaunch === false) {
      ensureAppDirs()
    }

    return {
      success: true,
      from: result.from,
      to: result.to,
      requiresRelaunch: result.requiresRelaunch,
    }
  })
}
