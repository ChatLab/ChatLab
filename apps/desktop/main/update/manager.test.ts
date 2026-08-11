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
  checkResults: unknown[] = []

  setFeedURL(url: unknown): void {
    this.feedUrls.push(url)
  }

  async checkForUpdates(): Promise<unknown> {
    this.checkCalls++
    const result = this.checkResults.length
      ? this.checkResults.shift()
      : { isUpdateAvailable: false, updateInfo: { version: '0.36.0' } }
    if (result instanceof Error) {
      this.emit('error', result)
      throw result
    }
    return result
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
  const dialogResponses: number[] = []
  const externalUrls: string[] = []
  const logMessages: string[] = []
  let quitCalls = 0

  await mock.module('electron', {
    namedExports: {
      app: {
        isPackaged: true,
        quit() {
          quitCalls++
        },
      },
      dialog: {
        async showMessageBox(parentOrOptions: unknown, maybeOptions?: DialogCall) {
          const options = maybeOptions ?? (parentOrOptions as DialogCall)
          dialogCalls.push({
            ...options,
            parent: maybeOptions ? parentOrOptions : undefined,
          })
          return { response: dialogResponses.shift() ?? 1 }
        },
        showErrorBox() {
          logMessages.push('showErrorBox')
        },
      },
      shell: {
        async openExternal(url: string) {
          externalUrls.push(url)
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
        warn(message: string) {
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
    dialogResponses,
    externalUrls,
    getQuitCalls: () => quitCalls,
    checkUpdate: mod.checkUpdate as unknown as (win: FakeUpdateWindow) => void,
    manualCheckForUpdates: mod.manualCheckForUpdates as () => void,
    recoverRequiredDesktopUpdate: mod.recoverRequiredDesktopUpdate as (requirement: {
      currentVersion: string
      minRuntimeVersion: string
      userDataDir: string
    }) => Promise<void>,
  }
}

test('desktop updater workflows', async (t) => {
  const harness = await loadUpdaterModule()

  await t.test('required update retries with GitHub, downloads, and installs without opening the app', async () => {
    const networkError = Object.assign(new Error('network timeout'), { code: 'ETIMEDOUT' })
    harness.autoUpdater.checkResults.push(networkError, {
      isUpdateAvailable: true,
      updateInfo: { version: '0.36.0' },
      cancellationToken: {},
    })
    harness.dialogResponses.push(0)

    await harness.recoverRequiredDesktopUpdate({
      currentVersion: '0.35.0',
      minRuntimeVersion: '0.35.1',
      userDataDir: '/tmp/chatlab-data',
    })

    assert.equal(harness.autoUpdater.checkCalls, 2)
    assert.equal(harness.autoUpdater.downloadCalls, 1)
    assert.equal(harness.autoUpdater.quitInstallCalls, 1)
    assert.equal(harness.getQuitCalls(), 0)
    assert.deepEqual(harness.autoUpdater.feedUrls.at(-1), {
      provider: 'github',
      owner: 'ChatLab',
      repo: 'ChatLab',
    })
  })

  await t.test('required update failure offers the official download page and quits safely', async () => {
    harness.autoUpdater.checkResults.push(null)
    harness.dialogResponses.push(0, 0)

    await harness.recoverRequiredDesktopUpdate({
      currentVersion: '0.35.0',
      minRuntimeVersion: '0.35.1',
      userDataDir: '/tmp/chatlab-data',
    })

    assert.equal(harness.dialogCalls.at(-1)?.title, 'update.requiredUpdateFailedTitle')
    assert.deepEqual(harness.externalUrls, ['https://github.com/ChatLab/ChatLab/releases'])
    assert.equal(harness.getQuitCalls(), 1)
  })

  await t.test('automatic stable updates defer the install prompt until the app window is active', async () => {
    const sent: unknown[][] = []
    const downloadsBefore = harness.autoUpdater.downloadCalls
    const win = new FakeUpdateWindow({
      send: (...args: unknown[]) => sent.push(args),
    })
    win.focused = false

    harness.checkUpdate(win)

    harness.autoUpdater.emit('update-available', { version: '0.36.1' })
    await Promise.resolve()

    assert.equal(harness.autoUpdater.downloadCalls, downloadsBefore + 1)
    assert.equal(harness.autoUpdater.autoDownload, false)
    assert.equal(harness.autoUpdater.autoInstallOnAppQuit, false)

    harness.autoUpdater.emit('update-downloaded', { version: '0.36.1' })
    await Promise.resolve()

    assert.notEqual(harness.dialogCalls.at(-1)?.title, 'update.downloadComplete')

    win.focused = true
    win.emit('focus')
    await new Promise<void>((resolve) => setImmediate(resolve))

    assert.equal(harness.dialogCalls.at(-1)?.title, 'update.downloadComplete')
    assert.equal(harness.dialogCalls.at(-1)?.message, 'update.readyToInstall')
    assert.equal(harness.dialogCalls.at(-1)?.parent, win)

    harness.manualCheckForUpdates()
    harness.autoUpdater.emit('update-available', { version: '0.36.2' })
    await new Promise<void>((resolve) => setImmediate(resolve))

    assert.equal(harness.dialogCalls.at(-1)?.title, 'update.newVersionTitle:0.36.2')
    assert.equal(harness.dialogCalls.at(-1)?.message, 'update.newVersionMessage:0.36.2')
    assert.equal(harness.dialogCalls.at(-1)?.parent, win)
    assert.equal(harness.autoUpdater.downloadCalls, downloadsBefore + 1)
  })
})
