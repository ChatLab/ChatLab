import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mock, test } from 'node:test'

class FakeAutoUpdater extends EventEmitter {
  autoDownload = false
  autoInstallOnAppQuit = true
  downloadCalls = 0
  checkCalls = 0
  quitInstallCalls = 0
  feedUrls: unknown[] = []

  setFeedURL(url: unknown): void {
    this.feedUrls.push(url)
  }

  async checkForUpdates(): Promise<void> {
    this.checkCalls++
  }

  async downloadUpdate(): Promise<void> {
    this.downloadCalls++
  }

  quitAndInstall(): void {
    this.quitInstallCalls++
  }
}

type DialogCall = {
  title?: string
  message?: string
  detail?: string
  buttons?: string[]
}

async function loadUpdaterModule() {
  const autoUpdater = new FakeAutoUpdater()
  const dialogCalls: DialogCall[] = []
  const logMessages: string[] = []

  await mock.module('electron', {
    namedExports: {
      app: {
        isPackaged: true,
      },
      dialog: {
        async showMessageBox(options: DialogCall) {
          dialogCalls.push(options)
          return { response: 1 }
        },
      },
    },
  })
  await mock.module('electron-updater', {
    namedExports: { autoUpdater },
  })
  await mock.module('@electron-toolkit/utils', {
    namedExports: { platform: { isWindows: false } },
  })
  await mock.module('../logger', {
    namedExports: {
      logger: {
        info(message: string) {
          logMessages.push(message)
        },
        error(message: string) {
          logMessages.push(message)
        },
      },
    },
  })
  await mock.module('../network/proxy', {
    namedExports: {
      getActiveProxyUrl: () => undefined,
    },
  })
  await mock.module('../worker/workerManager', {
    namedExports: {
      closeWorkerAsync: async () => undefined,
    },
  })
  await mock.module('../i18n', {
    namedExports: {
      t: (key: string, params?: Record<string, string>) => `${key}${params?.version ? `:${params.version}` : ''}`,
    },
  })

  const mod = await import('./manager.js')
  return {
    autoUpdater,
    dialogCalls,
    checkUpdate: mod.checkUpdate as (win: { webContents: { send: (...args: unknown[]) => void } }) => void,
    manualCheckForUpdates: mod.manualCheckForUpdates as () => void,
  }
}

test('automatic stable updates download silently before showing install prompt', async () => {
  const { autoUpdater, dialogCalls, checkUpdate, manualCheckForUpdates } = await loadUpdaterModule()
  const sent: unknown[][] = []

  checkUpdate({
    webContents: {
      send: (...args: unknown[]) => sent.push(args),
    },
  })

  autoUpdater.emit('update-available', { version: '0.28.2' })
  await Promise.resolve()

  assert.equal(autoUpdater.downloadCalls, 1)
  assert.equal(dialogCalls.length, 0)
  assert.equal(autoUpdater.autoDownload, false)
  assert.equal(autoUpdater.autoInstallOnAppQuit, false)

  autoUpdater.emit('update-downloaded', { version: '0.28.2' })
  await Promise.resolve()

  assert.equal(dialogCalls.length, 1)
  assert.equal(dialogCalls[0]?.title, 'update.downloadComplete')
  assert.equal(dialogCalls[0]?.message, 'update.readyToInstall')

  manualCheckForUpdates()
  autoUpdater.emit('update-available', { version: '0.28.3' })
  await Promise.resolve()

  assert.equal(dialogCalls.length, 2)
  assert.equal(dialogCalls[1]?.title, 'update.newVersionTitle:0.28.3')
  assert.equal(dialogCalls[1]?.message, 'update.newVersionMessage:0.28.3')
  assert.equal(autoUpdater.downloadCalls, 1)
})
