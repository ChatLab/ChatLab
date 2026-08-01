import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, mock, test } from 'node:test'
import * as dataDirSwitch from '../../../../packages/node-runtime/src/data-dir-switch'

const tempRoot = process.env.CHATLAB_TEST_TMPDIR ?? (fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir())
const root = fs.mkdtempSync(path.join(tempRoot, 'chatlab-desktop-paths-'))
const electronUserDataDir = path.join(root, 'electron-user-data')
const documentsDir = path.join(root, 'Documents')
const currentDir = path.join(root, 'current-data')
const targetDir = path.join(root, 'target-data')
const originalHome = process.env.HOME
const originalDataDir = process.env.CHATLAB_DATA_DIR
let configuredUserDataDir = currentDir
let paths: typeof import('./locations.js') &
  typeof import('./data-dir-switch.js') &
  typeof import('./legacy-migration.js')

before(async () => {
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

  paths = {
    ...(await import('./locations.js')),
    ...(await import('./data-dir-switch.js')),
    ...(await import('./legacy-migration.js')),
  }
})

beforeEach(() => {
  for (const entry of fs.readdirSync(root)) fs.rmSync(path.join(root, entry), { recursive: true, force: true })
  fs.mkdirSync(electronUserDataDir, { recursive: true })
  fs.mkdirSync(path.join(currentDir, 'databases'), { recursive: true })
  fs.writeFileSync(path.join(currentDir, 'databases', 'current.db'), 'sqlite', 'utf-8')
  configuredUserDataDir = currentDir
  paths.setCachedUserDataDir(currentDir)
})

after(() => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalDataDir === undefined) delete process.env.CHATLAB_DATA_DIR
  else process.env.CHATLAB_DATA_DIR = originalDataDir
  fs.rmSync(root, { recursive: true, force: true })
})

test('desktop paths switch configured data directories without deleting the source', () => {
  paths.ensureAppDirs()
  assert.equal(paths.getUserDataDir(), currentDir)
  assert.equal(fs.existsSync(path.join(currentDir, '.chatlab')), true)
  assert.equal(fs.existsSync(path.join(root, '.chatlab', 'logs')), true)
  assert.equal(fs.existsSync(path.join(root, 'chatlab-temp', 'runtime')), true)

  assert.deepEqual(paths.setCustomDataDir(targetDir, true), {
    success: true,
    from: currentDir,
    to: targetDir,
    requiresRelaunch: true,
  })
  assert.equal(paths.applyPendingDataDirMigration().success, true)
  assert.equal(configuredUserDataDir, targetDir)
  assert.equal(fs.readFileSync(path.join(targetDir, 'databases', 'current.db'), 'utf-8'), 'sqlite')

  paths.preserveLegacyPendingDeleteDir()
  assert.equal(fs.existsSync(currentDir), true)
  assert.equal(dataDirSwitch.getPendingDataDirCleanups(path.join(root, '.chatlab'))[0]?.sourceDir, currentDir)
})

test('desktop paths convert legacy automatic deletion into manual cleanup', () => {
  const legacyCleanupDir = path.join(root, 'legacy-cleanup-data')
  fs.mkdirSync(path.join(legacyCleanupDir, 'databases'), { recursive: true })
  fs.writeFileSync(path.join(legacyCleanupDir, '.chatlab'), 'ChatLab Data Directory', 'utf-8')
  fs.writeFileSync(path.join(legacyCleanupDir, 'databases', 'legacy-cleanup.db'), 'sqlite', 'utf-8')
  fs.writeFileSync(
    path.join(electronUserDataDir, 'storage.json'),
    JSON.stringify({ pendingDeleteDir: legacyCleanupDir })
  )

  paths.preserveLegacyPendingDeleteDir()

  assert.equal(fs.existsSync(legacyCleanupDir), true)
  assert.equal(
    dataDirSwitch
      .getPendingDataDirCleanups(path.join(root, '.chatlab'))
      .some((cleanup) => cleanup.sourceDir === legacyCleanupDir),
    true
  )
})

test('legacy migration refuses active directories that overlap the source', () => {
  const legacyDir = createLegacyDocumentsData()

  const assertBlocked = (activeDir: string) => {
    configuredUserDataDir = activeDir
    paths.setCachedUserDataDir(activeDir)
    assert.equal(paths.needsLegacyMigration(), false, activeDir)
    assert.equal(paths.migrateFromLegacyDir().success, true, activeDir)
    assert.equal(paths.removeLegacyDir(), false, activeDir)
    assert.equal(fs.readFileSync(path.join(legacyDir, 'databases', 'legacy.db'), 'utf-8'), 'legacy', activeDir)
  }

  assertBlocked(legacyDir)
  assertBlocked(documentsDir)

  const aliasDir = path.join(root, 'legacy-alias')
  fs.symlinkSync(legacyDir, aliasDir, process.platform === 'win32' ? 'junction' : 'dir')
  assertBlocked(aliasDir)
})

test('legacy migration protects a newly selected directory nested under the legacy source', () => {
  const legacyDir = createLegacyDocumentsData()
  const nestedActiveDir = path.join(legacyDir, 'active-data')

  assert.equal(paths.setCustomDataDir(nestedActiveDir, true).success, true)
  assert.equal(paths.applyPendingDataDirMigration().success, true)
  assert.equal(configuredUserDataDir, nestedActiveDir)
  assert.equal(paths.needsLegacyMigration(), false)
  assert.equal(paths.migrateFromLegacyDir().success, true)
  assert.equal(paths.removeLegacyDir(), false)
  assert.equal(fs.readFileSync(path.join(nestedActiveDir, 'databases', 'current.db'), 'utf-8'), 'sqlite')
  assert.equal(fs.readFileSync(path.join(legacyDir, 'databases', 'legacy.db'), 'utf-8'), 'legacy')
})

test('legacy migration copies persistent data, skips temp files, and removes the old directory', () => {
  const legacyDir = createLegacyDocumentsData()

  assert.equal(paths.needsLegacyMigration(), true)
  assert.equal(paths.migrateFromLegacyDir().success, true)
  assert.equal(fs.readFileSync(path.join(currentDir, 'databases', 'legacy.db'), 'utf-8'), 'legacy')
  assert.equal(fs.existsSync(path.join(currentDir, 'temp', 'stale.tmp')), false)
  assert.equal(fs.existsSync(legacyDir), false)
})

test('unified directory migration moves system data but preserves old temporary files', () => {
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
})

function createLegacyDocumentsData(): string {
  const legacyDir = path.join(documentsDir, 'ChatLab')
  fs.mkdirSync(path.join(legacyDir, 'databases'), { recursive: true })
  fs.mkdirSync(path.join(legacyDir, 'temp'), { recursive: true })
  fs.writeFileSync(path.join(legacyDir, 'databases', 'legacy.db'), 'legacy', 'utf-8')
  fs.writeFileSync(path.join(legacyDir, 'temp', 'stale.tmp'), 'temporary', 'utf-8')
  return legacyDir
}
