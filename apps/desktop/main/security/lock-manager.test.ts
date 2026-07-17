import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mock, test } from 'node:test'

class FakeMainWindow {
  readonly sentMessages: unknown[][] = []
  readonly webContents = {
    send: (...args: unknown[]) => this.sentMessages.push(args),
  }

  isDestroyed(): boolean {
    return false
  }
}

function makeTempDir(): string {
  const baseDir = process.env.CHATLAB_TEST_TMPDIR ?? (fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir())
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-app-lock-'))
}

test('desktop app lock persists its canonical config and handles manual, idle, and startup locking', async () => {
  const root = makeTempDir()
  const settingsDir = path.join(root, 'settings')
  const mainWindow = new FakeMainWindow()
  let systemIdleSeconds = 0
  let cleanupLockManager: (() => void) | undefined

  await mock.module('electron', {
    namedExports: {
      powerMonitor: {
        getSystemIdleTime: () => systemIdleSeconds,
      },
    },
  })
  await mock.module('../paths/provider', {
    namedExports: {
      getPathProvider: () => ({ getSettingsDir: () => settingsDir }),
    },
  })
  await mock.module('../logger', {
    namedExports: {
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined,
      },
    },
  })

  try {
    fs.mkdirSync(settingsDir, { recursive: true })
    fs.writeFileSync(
      path.join(settingsDir, 'app-lock.json'),
      JSON.stringify({ enabled: true, idleTimeoutMinutes: 0, lockOnStartup: false }),
      'utf-8'
    )
    fs.writeFileSync(path.join(settingsDir, '.app-lock-flag'), 'stale', 'utf-8')

    const lockManager = await import('./lock-manager.js')
    cleanupLockManager = lockManager.cleanupLockManager
    lockManager.initLockManager(mainWindow as never)

    assert.deepEqual(lockManager.getLockConfig(), {
      enabled: false,
      idleTimeoutMinutes: 0,
      lockOnStartup: false,
    })
    assert.equal(fs.existsSync(path.join(settingsDir, '.app-lock-flag')), false)

    assert.deepEqual(await lockManager.setPassword('123'), { success: false, error: 'invalid-pin' })
    assert.deepEqual(await lockManager.setPassword('1234'), { success: true })
    assert.deepEqual(lockManager.getLockConfig(), {
      enabled: true,
      idleTimeoutMinutes: 0,
      lockOnStartup: false,
    })

    const persisted = JSON.parse(fs.readFileSync(path.join(settingsDir, 'app-lock.json'), 'utf-8')) as {
      passwordHash: { hash: string; salt: string; version: number }
    }
    assert.deepEqual(Object.keys(persisted).sort(), ['idleTimeoutMinutes', 'lockOnStartup', 'passwordHash'])
    assert.equal(persisted.passwordHash.version, 1)
    assert.equal(persisted.passwordHash.hash.length, 128)
    assert.equal(persisted.passwordHash.salt.length, 64)

    assert.deepEqual(lockManager.updateLockConfig({ enabled: true }), {
      success: false,
      error: 'invalid-config',
    })
    assert.equal(lockManager.updateLockConfig({ idleTimeoutMinutes: 5 }).success, true)
    assert.equal(lockManager.updateLockConfig({ idleTimeoutMinutes: 0 }).success, true)

    assert.deepEqual(lockManager.lockApp(), { success: true })
    assert.equal(lockManager.getLockState(), 'locked')
    assert.deepEqual(await lockManager.unlockApp('0000'), {
      success: false,
      error: 'wrong-password',
      wrongPassword: true,
    })
    assert.deepEqual(await lockManager.unlockApp('1234'), { success: true })
    assert.deepEqual(mainWindow.sentMessages.slice(-2), [
      ['app-lock-state-changed', true],
      ['app-lock-state-changed', false],
    ])

    assert.deepEqual(await lockManager.changePassword('1234', '1234'), {
      success: false,
      error: 'same-password',
    })
    assert.deepEqual(await lockManager.changePassword('1234', '4321'), { success: true })

    systemIdleSeconds = 60
    assert.equal(lockManager.updateLockConfig({ idleTimeoutMinutes: 1 }).success, true)
    assert.equal(lockManager.getLockState(), 'locked')
    systemIdleSeconds = 0
    assert.deepEqual(await lockManager.unlockApp('4321'), { success: true })

    assert.equal(lockManager.updateLockConfig({ lockOnStartup: true }).success, true)
    lockManager.cleanupLockManager()
    lockManager.initLockManager(mainWindow as never)
    assert.equal(lockManager.getLockState(), 'locked')
    assert.deepEqual(await lockManager.unlockApp('4321'), { success: true })

    assert.deepEqual(lockManager.resetAppLockPassword(), { success: true })
    assert.equal(lockManager.getLockConfig().enabled, false)
    assert.deepEqual(lockManager.lockApp(), { success: false, error: 'disabled' })
  } finally {
    cleanupLockManager?.()
    fs.rmSync(root, { recursive: true, force: true })
  }
})
