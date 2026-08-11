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
  parent?: unknown
}

class FakeUpdateWindow extends EventEmitter {
  visible = true
  focused = true
  destroyed = false

  constructor(readonly webContents: { send: (...args: unknown[]) => void }) {
    super()
  }

  isVisible(): boolean {
    return this.visible
  }

  isFocused(): boolean {
    return this.focused
  }

  isDestroyed(): boolean {
    return this.destroyed
  }
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
        async showMessageBox(parentOrOptions: unknown, maybeOptions?: DialogCall) {
          const options = maybeOptions ?? (parentOrOptions as DialogCall)
          dialogCalls.push({
            ...options,
            parent: maybeOptions ? parentOrOptions : undefined,
          })
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
    checkUpdate: mod.checkUpdate as unknown as (win: FakeUpdateWindow) => void,
    manualCheckForUpdates: mod.manualCheckForUpdates as () => void,
  }
}

test('automatic stable updates defer the install prompt until the app window is active', async () => {
  const { autoUpdater, dialogCalls, checkUpdate, manualCheckForUpdates } = await loadUpdaterModule()
  const sent: unknown[][] = []
  const win = new FakeUpdateWindow({
    send: (...args: unknown[]) => sent.push(args),
  })
  win.focused = false

  checkUpdate(win)

  autoUpdater.emit('update-available', { version: '0.28.2' })
  await Promise.resolve()

  assert.equal(autoUpdater.downloadCalls, 1)
  assert.equal(dialogCalls.length, 0)
  assert.equal(autoUpdater.autoDownload, false)
  assert.equal(autoUpdater.autoInstallOnAppQuit, false)

  autoUpdater.emit('update-downloaded', { version: '0.28.2' })
  await Promise.resolve()

  assert.equal(dialogCalls.length, 0)

  win.focused = true
  win.emit('focus')
  await new Promise<void>((resolve) => setImmediate(resolve))

  assert.equal(dialogCalls.length, 1)
  assert.equal(dialogCalls[0]?.title, 'update.downloadComplete')
  assert.equal(dialogCalls[0]?.message, 'update.readyToInstall')
  assert.equal(dialogCalls[0]?.parent, win)

  manualCheckForUpdates()
  autoUpdater.emit('update-available', { version: '0.28.3' })
  await new Promise<void>((resolve) => setImmediate(resolve))

  assert.equal(dialogCalls.length, 2)
  assert.equal(dialogCalls[1]?.title, 'update.newVersionTitle:0.28.3')
  assert.equal(dialogCalls[1]?.message, 'update.newVersionMessage:0.28.3')
  assert.equal(dialogCalls[1]?.parent, win)
  assert.equal(autoUpdater.downloadCalls, 1)
})
