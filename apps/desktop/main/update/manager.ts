import { dialog, app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { platform } from '@electron-toolkit/utils'
import { logger } from '../logger'
import { closeWorkerAsync } from '../worker/workerManager'
import { t } from '../i18n'
import { configureUpdateProxy, handleUpdateError, resetToDefaultSource } from './source'

type AppWithQuitFlag = typeof app & { isQuiting?: boolean }

interface UpdateWindow {
  webContents: {
    send(channel: string, ...args: unknown[]): void
  }
}

const appWithQuitFlag = app as AppWithQuitFlag

let isFirstShow = true
let isManualCheck = false

export function checkUpdate(win: UpdateWindow): void {
  configureUpdateProxy()

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  let showUpdateMessageBox = false
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
    dialog
      .showMessageBox({
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
        showUpdateMessageBox = false
        if (result.response === 0) {
          startDownloadUpdate()
        }
      })
  })

  autoUpdater.on('download-progress', (progress) => {
    console.log(`Update download progress: ${progress.percent}%`)
    win.webContents.send('update-download-progress', progress.percent)
  })

  autoUpdater.on('update-downloaded', () => {
    dialog
      .showMessageBox({
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

export function simulateUpdateDialog(_win: UpdateWindow): void {
  void dialog.showMessageBox({
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
