import { dialog, app, shell, type BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { platform } from '@electron-toolkit/utils'
import { isRuntimeVersionAtLeast } from '@openchatlab/node-runtime/data-dir-compat'
import { logger } from '../logger'
import { closeWorkerAsync } from '../worker/workerManager'
import { t } from '../i18n'
import type { DesktopUpdateRequirement } from '../runtime/compat'
import {
  configureUpdateProxy,
  handleUpdateError,
  isUpdateNetworkError,
  resetToDefaultSource,
  switchToGitHubUpdateSource,
} from './source'

type AppWithQuitFlag = typeof app & { isQuiting?: boolean }

const appWithQuitFlag = app as AppWithQuitFlag
const OFFICIAL_RELEASES_URL = 'https://github.com/ChatLab/ChatLab/releases'

let isFirstShow = true
let isManualCheck = false

function runWhenWindowActive(win: BrowserWindow, callback: () => void): void {
  const tryRun = (): boolean => {
    if (win.isDestroyed()) {
      win.removeListener('focus', tryRun)
      return true
    }
    if (!win.isVisible() || !win.isFocused()) return false

    win.removeListener('focus', tryRun)
    callback()
    return true
  }

  if (!tryRun()) {
    win.on('focus', tryRun)
  }
}

export async function recoverRequiredDesktopUpdate(requirement: DesktopUpdateRequirement): Promise<void> {
  configureUpdater()
  configureUpdateProxy()
  resetToDefaultSource()

  const prompt = await dialog.showMessageBox({
    title: t('update.requiredTitle'),
    message: t('update.requiredMessage', {
      currentVersion: requirement.currentVersion,
      minRuntimeVersion: requirement.minRuntimeVersion,
    }),
    detail: t('update.requiredDetail', {
      minRuntimeVersion: requirement.minRuntimeVersion,
      userDataDir: requirement.userDataDir,
    }),
    buttons: [t('update.updateNow'), t('update.openDownloadPage'), t('update.quit')],
    defaultId: 0,
    cancelId: 2,
    type: 'warning',
    noLink: true,
  })

  if (prompt.response === 1) {
    await openOfficialReleasesAndQuit()
    return
  }
  if (prompt.response !== 0) {
    app.quit()
    return
  }

  const logUpdaterError = (error: Error): void => {
    logger.error('[Update] Required desktop update error', error)
  }
  autoUpdater.on('error', logUpdaterError)

  try {
    const update = await checkRequiredUpdateWithFallback()
    if (
      !update?.isUpdateAvailable ||
      !isRuntimeVersionAtLeast(update.updateInfo.version, requirement.minRuntimeVersion)
    ) {
      throw new Error(
        `No compatible desktop update is available (required ${requirement.minRuntimeVersion}, received ${update?.updateInfo.version ?? 'none'}).`
      )
    }

    await autoUpdater.downloadUpdate(update.cancellationToken)
    appWithQuitFlag.isQuiting = true
    autoUpdater.quitAndInstall(true, true)
  } catch (error) {
    logger.error('[Update] Failed to recover from an incompatible data directory', error)
    await showRequiredUpdateFailure(requirement.minRuntimeVersion)
  } finally {
    autoUpdater.off('error', logUpdaterError)
  }
}

export function checkUpdate(win: BrowserWindow): void {
  configureUpdateProxy()
  configureUpdater()

  let showUpdateMessageBox = false
  let showInstallMessageBox = false
  let isDownloadingUpdate = false

  const startDownloadUpdate = (): void => {
    if (isDownloadingUpdate) return
    isDownloadingUpdate = true
    autoUpdater
      .downloadUpdate()
      .then(() => {
        console.log('wait for post download operation')
      })
      .catch((downloadError) => {
        logger.error(`[Update] Download update failed: ${downloadError}`)
      })
      .finally(() => {
        isDownloadingUpdate = false
      })
  }

  autoUpdater.on('update-available', (info) => {
    if (showUpdateMessageBox) return

    const isPreRelease = isPreReleaseVersion(info.version)
    if (isPreRelease && !isManualCheck) {
      console.log(`[Update] Pre-release version found: ${info.version}, skipping auto-update prompt`)
      logger.info(
        `[Update] Pre-release version found: ${info.version}, skipping auto-update prompt (manual check required)`
      )
      return
    }

    if (!isManualCheck) {
      logger.info(`[Update] New version ${info.version} found, downloading silently`)
      startDownloadUpdate()
      return
    }

    showUpdateMessageBox = true
    runWhenWindowActive(win, () => {
      void dialog
        .showMessageBox(win, {
          title: t('update.newVersionTitle', { version: info.version }),
          message: t('update.newVersionMessage', { version: info.version }),
          detail: t('update.newVersionDetail'),
          buttons: [t('update.downloadNow'), t('update.cancel')],
          defaultId: 0,
          cancelId: 1,
          type: 'question',
          noLink: true,
        })
        .then((result) => {
          if (result.response === 0) {
            startDownloadUpdate()
          }
        })
        .finally(() => {
          showUpdateMessageBox = false
        })
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    console.log(`Update download progress: ${progress.percent}%`)
    win.webContents.send('update-download-progress', progress.percent)
  })

  autoUpdater.on('update-downloaded', () => {
    if (showInstallMessageBox) return

    showInstallMessageBox = true
    runWhenWindowActive(win, () => {
      void dialog
        .showMessageBox(win, {
          title: t('update.downloadComplete'),
          message: t('update.readyToInstall'),
          buttons: [t('update.install'), t('update.remindLater')],
          defaultId: 1,
          cancelId: 1,
          type: 'question',
        })
        .then(async (result) => {
          if (result.response !== 0) return

          win.webContents.send('begin-install')
          appWithQuitFlag.isQuiting = true

          if (platform.isWindows) {
            logger.info('[Update] Windows: Closing worker before installing...')
            try {
              await closeWorkerAsync()
            } catch (error) {
              logger.error(`[Update] Failed to close worker: ${error}`)
            }
          }

          setTimeout(() => {
            setImmediate(() => {
              autoUpdater.quitAndInstall(true, true)
            })
          }, 100)
        })
        .finally(() => {
          showInstallMessageBox = false
        })
    })
  })

  autoUpdater.on('update-not-available', () => {
    if (isFirstShow) {
      isFirstShow = false
    } else {
      win.webContents.send('show-message', {
        type: 'success',
        message: t('update.upToDate'),
      })
    }
  })

  autoUpdater.on('error', handleUpdateError)

  setTimeout(() => {
    isManualCheck = false
    resetToDefaultSource()

    autoUpdater.checkForUpdates().catch((error) => {
      console.log('[Update] Update check failed:', error)
    })
  }, 3000)
}

export function manualCheckForUpdates(): void {
  configureUpdateProxy()
  isManualCheck = true
  isFirstShow = false
  resetToDefaultSource()

  autoUpdater.checkForUpdates().catch((error) => {
    console.log('[Update] Manual update check failed:', error)
    logger.error(`[Update] Manual update check failed: ${error}`)
  })
}

export function simulateUpdateDialog(win: BrowserWindow): void {
  void dialog.showMessageBox(win, {
    title: t('update.newVersionTitle', { version: '9.9.9' }),
    message: t('update.newVersionMessage', { version: '9.9.9' }),
    detail: t('update.newVersionDetail'),
    buttons: [t('update.downloadNow'), t('update.cancel')],
    defaultId: 0,
    cancelId: 1,
    type: 'question',
    noLink: true,
  })
}

function isPreReleaseVersion(version: string): boolean {
  return /-/.test(version)
}

function configureUpdater(): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
}

async function checkRequiredUpdateWithFallback() {
  try {
    return await autoUpdater.checkForUpdates()
  } catch (error) {
    if (!(error instanceof Error) || !isUpdateNetworkError(error)) throw error
    logger.warn('[Update] Required update check failed on R2 mirror; retrying with GitHub')
    switchToGitHubUpdateSource()
    return await autoUpdater.checkForUpdates()
  }
}

async function showRequiredUpdateFailure(minRuntimeVersion: string): Promise<void> {
  const result = await dialog.showMessageBox({
    title: t('update.requiredUpdateFailedTitle'),
    message: t('update.requiredUpdateFailedMessage'),
    detail: t('update.requiredUpdateFailedDetail', { minRuntimeVersion }),
    buttons: [t('update.openDownloadPage'), t('update.quit')],
    defaultId: 0,
    cancelId: 1,
    type: 'error',
    noLink: true,
  })

  if (result.response === 0) {
    await openOfficialReleasesAndQuit()
    return
  }
  app.quit()
}

async function openOfficialReleasesAndQuit(): Promise<void> {
  try {
    await shell.openExternal(OFFICIAL_RELEASES_URL)
  } catch (error) {
    logger.error('[Update] Failed to open the official releases page', error)
    dialog.showErrorBox(
      t('update.requiredUpdateFailedTitle'),
      `${t('update.openDownloadFailed')}\n\n${OFFICIAL_RELEASES_URL}`
    )
  } finally {
    app.quit()
  }
}
