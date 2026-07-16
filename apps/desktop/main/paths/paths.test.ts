import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mock, test } from 'node:test'
import * as dataDirSwitch from '../../../../packages/node-runtime/src/data-dir-switch'

test('desktop paths preserve data across configured and legacy directory migrations', async () => {
  const tempRoot = process.env.CHATLAB_TEST_TMPDIR ?? (fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir())
  const root = fs.mkdtempSync(path.join(tempRoot, 'chatlab-desktop-paths-'))
  const originalHome = process.env.HOME
  const originalDataDir = process.env.CHATLAB_DATA_DIR
  const electronUserDataDir = path.join(root, 'electron-user-data')
  const documentsDir = path.join(root, 'Documents')
  const currentDir = path.join(root, 'current-data')
  const targetDir = path.join(root, 'target-data')
  let configuredUserDataDir = currentDir

  fs.mkdirSync(electronUserDataDir, { recursive: true })
  fs.mkdirSync(path.join(currentDir, 'databases'), { recursive: true })
  fs.writeFileSync(path.join(currentDir, 'databases', 'current.db'), 'sqlite', 'utf-8')
  process.env.HOME = root
  delete process.env.CHATLAB_DATA_DIR

  await mock.module('electron', {
    namedExports: {
      app: {
        getPath(name: string) {
          if (name === 'userData') return electronUserDataDir
          if (name === 'documents') return documentsDir
          if (name === 'downloads') return path.join(root, 'Downloads')
          if (name === 'exe') return path.join(root, 'app', 'ChatLab')
          throw new Error(`Unexpected Electron path: ${name}`)
        },
      },
    },
  })
  await mock.module('@openchatlab/config', {
    namedExports: {
      loadConfig: () => ({ data: { user_data_dir: configuredUserDataDir, electron_migration_done: false } }),
      writeConfigField(section: string, key: string, value: unknown) {
        if (section === 'data' && key === 'user_data_dir') configuredUserDataDir = String(value)
      },
    },
  })
  await mock.module('@openchatlab/node-runtime', { namedExports: dataDirSwitch })
  await mock.module('@openchatlab/node-runtime/temp-workspace', {
    namedExports: { getChatLabTempScopeDir: () => path.join(root, 'chatlab-temp', 'runtime') },
  })

  try {
    const paths = {
      ...(await import('./locations.js')),
      ...(await import('./data-dir-switch.js')),
      ...(await import('./legacy-migration.js')),
    }

    paths.ensureAppDirs()
    assert.equal(paths.getUserDataDir(), currentDir)
    assert.equal(fs.existsSync(path.join(currentDir, '.chatlab')), true)
    assert.equal(fs.existsSync(path.join(root, '.chatlab', 'logs')), true)
    assert.equal(fs.existsSync(path.join(root, 'chatlab-temp', 'runtime')), true)

    const switchResult = paths.setCustomDataDir(targetDir, true)
    assert.deepEqual(switchResult, {
      success: true,
      from: currentDir,
      to: targetDir,
      requiresRelaunch: true,
    })

    const applyResult = paths.applyPendingDataDirMigration()
    assert.equal(applyResult.success, true)
    assert.equal(configuredUserDataDir, targetDir)
    assert.equal(fs.readFileSync(path.join(targetDir, 'databases', 'current.db'), 'utf-8'), 'sqlite')

    paths.cleanupPendingDeleteDir()
    assert.equal(fs.existsSync(currentDir), false)

    const legacyDir = path.join(documentsDir, 'ChatLab')
    fs.mkdirSync(path.join(legacyDir, 'databases'), { recursive: true })
    fs.mkdirSync(path.join(legacyDir, 'temp'), { recursive: true })
    fs.writeFileSync(path.join(legacyDir, 'databases', 'legacy.db'), 'legacy', 'utf-8')
    fs.writeFileSync(path.join(legacyDir, 'temp', 'stale.tmp'), 'temporary', 'utf-8')

    assert.equal(paths.needsLegacyMigration(), true)
    const legacyResult = paths.migrateFromLegacyDir()
    assert.equal(legacyResult.success, true)
    assert.equal(fs.readFileSync(path.join(targetDir, 'databases', 'legacy.db'), 'utf-8'), 'legacy')
    assert.equal(fs.existsSync(path.join(targetDir, 'temp', 'stale.tmp')), false)
    assert.equal(fs.existsSync(legacyDir), false)

    const oldElectronDataDir = path.join(electronUserDataDir, 'data')
    fs.mkdirSync(path.join(oldElectronDataDir, 'databases'), { recursive: true })
    fs.mkdirSync(path.join(oldElectronDataDir, 'ai'), { recursive: true })
    fs.mkdirSync(path.join(oldElectronDataDir, 'temp'), { recursive: true })
    fs.writeFileSync(path.join(oldElectronDataDir, 'databases', 'desktop.db'), 'sqlite', 'utf-8')
    fs.writeFileSync(path.join(oldElectronDataDir, 'ai', 'assistant.json'), '{}', 'utf-8')
    fs.writeFileSync(path.join(oldElectronDataDir, 'temp', 'stale.tmp'), 'temporary', 'utf-8')

    assert.equal(paths.needsUnifiedDirMigration(), true)
    assert.equal(paths.migrateToUnifiedDirs().success, true)
    assert.equal(fs.readFileSync(path.join(root, '.chatlab', 'ai', 'assistant.json'), 'utf-8'), '{}')
    assert.equal(fs.existsSync(path.join(root, '.chatlab', 'temp', 'stale.tmp')), false)
    assert.equal(fs.readFileSync(path.join(oldElectronDataDir, 'temp', 'stale.tmp'), 'utf-8'), 'temporary')
  } finally {
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
    if (originalDataDir === undefined) delete process.env.CHATLAB_DATA_DIR
    else process.env.CHATLAB_DATA_DIR = originalDataDir
    fs.rmSync(root, { recursive: true, force: true })
  }
})
