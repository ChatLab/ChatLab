import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, afterEach, before, beforeEach, mock, test } from 'node:test'

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

const root = makeTempDir()
const settingsDir = path.join(root, 'settings')
let systemIdleSeconds = 0
let mainWindow: FakeMainWindow
let lockManager: typeof import('./lock-manager.js')

before(async () => {
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
  lockManager = await import('./lock-manager.js')
})

beforeEach(() => {
  lockManager.cleanupLockManager()
  fs.rmSync(settingsDir, { recursive: true, force: true })
  fs.mkdirSync(settingsDir, { recursive: true })
  systemIdleSeconds = 0
  mainWindow = new FakeMainWindow()
})

afterEach(() => lockManager.cleanupLockManager())
after(() => fs.rmSync(root, { recursive: true, force: true }))

async function enableAppLock(pin = '1234'): Promise<void> {
  lockManager.initLockManager(mainWindow as never)
  assert.deepEqual(await lockManager.setPassword(pin), { success: true })
}

test('desktop app lock normalizes stale config and persists the canonical password shape', async () => {
  fs.writeFileSync(
    path.join(settingsDir, 'app-lock.json'),
    JSON.stringify({ enabled: true, idleTimeoutMinutes: 0, lockOnStartup: false }),
    'utf-8'
  )
  fs.writeFileSync(path.join(settingsDir, '.app-lock-flag'), 'stale', 'utf-8')

  lockManager.initLockManager(mainWindow as never)
  assert.deepEqual(lockManager.getLockConfig(), {
    enabled: false,
    idleTimeoutMinutes: 0,
    lockOnStartup: false,
  })
  assert.equal(fs.existsSync(path.join(settingsDir, '.app-lock-flag')), false)
  assert.deepEqual(await lockManager.setPassword('123'), { success: false, error: 'invalid-pin' })
  assert.deepEqual(await lockManager.setPassword('1234'), { success: true })

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
})

test('desktop app lock persists failed-attempt cooldown across restarts', async () => {
  await enableAppLock()
  assert.deepEqual(lockManager.lockApp(), { success: true })

  for (let attempt = 1; attempt < 5; attempt++) {
    assert.deepEqual(await lockManager.unlockApp('0000'), {
      success: false,
      error: 'wrong-password',
      wrongPassword: true,
    })
  }
  const blockedResult = await lockManager.unlockApp('0000')
  assert.equal(blockedResult.error, 'too-many-attempts')
  assert.equal(blockedResult.wrongPassword, true)
  assert.ok(blockedResult.retryAfterSeconds && blockedResult.retryAfterSeconds > 0)

  const flagPath = path.join(settingsDir, '.app-lock-flag')
  const blockedFlag = JSON.parse(fs.readFileSync(flagPath, 'utf-8')) as {
    failureCount: number
    cooldownUntil: number
  }
  assert.equal(blockedFlag.failureCount, 5)
  assert.ok(blockedFlag.cooldownUntil > Date.now())

  lockManager.cleanupLockManager()
  lockManager.initLockManager(mainWindow as never)
  assert.equal((await lockManager.unlockApp('1234')).error, 'too-many-attempts')

  blockedFlag.cooldownUntil = Date.now() - 1
  fs.writeFileSync(flagPath, JSON.stringify(blockedFlag), 'utf-8')
  lockManager.cleanupLockManager()
  lockManager.initLockManager(mainWindow as never)
  assert.deepEqual(await lockManager.unlockApp('1234'), { success: true })
  assert.deepEqual(mainWindow.sentMessages.slice(-2), [
    ['app-lock-state-changed', true],
    ['app-lock-state-changed', false],
  ])
})

test('desktop app lock handles manual locking, password changes, and reset independently', async () => {
  await enableAppLock()
  assert.deepEqual(lockManager.lockApp(), { success: true })
  assert.equal(lockManager.getLockState(), 'locked')
  assert.deepEqual(await lockManager.unlockApp('1234'), { success: true })

  assert.deepEqual(await lockManager.changePassword('1234', '1234'), {
    success: false,
    error: 'same-password',
  })
  assert.deepEqual(await lockManager.changePassword('1234', '4321'), { success: true })
  assert.deepEqual(lockManager.lockApp(), { success: true })
  assert.deepEqual(await lockManager.unlockApp('4321'), { success: true })

  assert.deepEqual(lockManager.resetAppLockPassword(), { success: true })
  assert.equal(lockManager.getLockConfig().enabled, false)
  assert.deepEqual(lockManager.lockApp(), { success: false, error: 'disabled' })
})

test('desktop app lock applies idle and startup locking independently', async () => {
  await enableAppLock()
  systemIdleSeconds = 60
  assert.equal(lockManager.updateLockConfig({ idleTimeoutMinutes: 1 }).success, true)
  assert.equal(lockManager.getLockState(), 'locked')

  systemIdleSeconds = 0
  assert.deepEqual(await lockManager.unlockApp('1234'), { success: true })
  assert.equal(lockManager.updateLockConfig({ lockOnStartup: true }).success, true)
  lockManager.cleanupLockManager()
  lockManager.initLockManager(mainWindow as never)
  assert.equal(lockManager.getLockState(), 'locked')
  assert.deepEqual(await lockManager.unlockApp('1234'), { success: true })
})
