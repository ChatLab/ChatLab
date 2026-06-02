import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  applyPendingNodeDataDirMigration,
  createPendingDataDirMigration,
  createNodeDataDirSwitch,
  getPendingNodeDataDirMigration,
  isExistingUserDataDir,
  runPendingDataDirMigration,
} from './data-dir-switch'
import { applyPendingNodeDataDirMigrationIfNeeded } from './node-path-provider'

function makeTempDir(): string {
  const baseDir = fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir()
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-data-switch-'))
}

function writeFile(filePath: string, content = 'data'): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf-8')
}

test('createPendingDataDirMigration records a restart-time migration without mutating config', () => {
  const pending = createPendingDataDirMigration({
    from: '/old/data',
    to: '/new/data',
    migrate: true,
    targetWasEmpty: true,
  })

  assert.equal(pending.from, '/old/data')
  assert.equal(pending.to, '/new/data')
  assert.equal(pending.migrate, true)
  assert.equal(pending.deleteSourceOnSuccess, true)
  assert.match(pending.createdAt, /^\d{4}-\d{2}-\d{2}T/)
})

test('runPendingDataDirMigration writes config only after copy succeeds', () => {
  const root = makeTempDir()
  const source = path.join(root, 'source')
  const target = path.join(root, 'target')
  writeFile(path.join(source, 'databases', 'session.db'), 'sqlite')

  let configuredDir = source
  let pendingCleared = false
  let pendingDeleteDir: string | null = null

  const result = runPendingDataDirMigration(
    createPendingDataDirMigration({ from: source, to: target, migrate: true, targetWasEmpty: true }),
    {
      writeUserDataDir(dir) {
        configuredDir = dir
      },
      clearPendingMigration() {
        pendingCleared = true
      },
      markPendingDeleteDir(dir) {
        pendingDeleteDir = dir
      },
    }
  )

  assert.equal(result.success, true)
  assert.equal(configuredDir, target)
  assert.equal(pendingCleared, true)
  assert.equal(pendingDeleteDir, source)
  assert.equal(fs.readFileSync(path.join(target, 'databases', 'session.db'), 'utf-8'), 'sqlite')
})

test('runPendingDataDirMigration keeps old config and pending task when copy fails', () => {
  const root = makeTempDir()
  const source = path.join(root, 'source')
  const target = path.join(root, 'target')
  writeFile(path.join(source, 'databases', 'session.db'), 'sqlite')

  let configuredDir = source
  let pendingCleared = false

  const result = runPendingDataDirMigration(
    createPendingDataDirMigration({ from: source, to: target, migrate: true, targetWasEmpty: true }),
    {
      copyDirMerge() {
        return { copied: 0, skipped: 0, errors: ['copy failed'] }
      },
      writeUserDataDir(dir) {
        configuredDir = dir
      },
      clearPendingMigration() {
        pendingCleared = true
      },
    }
  )

  assert.equal(result.success, false)
  assert.equal(configuredDir, source)
  assert.equal(pendingCleared, false)
  assert.equal(fs.existsSync(path.join(target, 'databases', 'session.db')), false)
})

test('runPendingDataDirMigration fails when source directory is missing', () => {
  const root = makeTempDir()
  const source = path.join(root, 'missing-source')
  const target = path.join(root, 'target')

  let configuredDir = source
  let pendingCleared = false

  const result = runPendingDataDirMigration(
    createPendingDataDirMigration({ from: source, to: target, migrate: true, targetWasEmpty: true }),
    {
      writeUserDataDir(dir) {
        configuredDir = dir
      },
      clearPendingMigration() {
        pendingCleared = true
      },
    }
  )

  assert.equal(result.success, false)
  assert.equal(configuredDir, source)
  assert.equal(pendingCleared, false)
  assert.equal(fs.existsSync(target), false)
})

test('isExistingUserDataDir accepts current user data layout without settings directory', () => {
  const root = makeTempDir()
  const dataDir = path.join(root, 'data')
  writeFile(path.join(dataDir, '.chatlab'), 'ChatLab Data Directory')
  fs.mkdirSync(path.join(dataDir, 'databases'), { recursive: true })

  assert.equal(isExistingUserDataDir(dataDir), true)
})

test('createNodeDataDirSwitch writes pending migration under the system settings directory', () => {
  const root = makeTempDir()
  const systemDir = path.join(root, 'system')
  const currentDir = path.join(root, 'current')
  const targetDir = path.join(root, 'target')
  writeFile(path.join(currentDir, 'databases', 'session.db'), 'sqlite')

  const result = createNodeDataDirSwitch({ systemDir, currentDir, targetDir, migrate: true })
  const pending = getPendingNodeDataDirMigration(systemDir)

  assert.equal(result.success, true)
  assert.equal(result.requiresRelaunch, true)
  assert.equal(pending?.from, currentDir)
  assert.equal(pending?.to, targetDir)
})

test('applyPendingNodeDataDirMigration deletes old data directory after successful migration to empty target', () => {
  const root = makeTempDir()
  const systemDir = path.join(root, 'system')
  const currentDir = path.join(root, 'current')
  const targetDir = path.join(root, 'target')
  writeFile(path.join(currentDir, '.chatlab'), 'ChatLab Data Directory')
  writeFile(path.join(currentDir, 'databases', 'session.db'), 'sqlite')

  const switchResult = createNodeDataDirSwitch({ systemDir, currentDir, targetDir, migrate: true })
  assert.equal(switchResult.success, true)

  const writes: Array<{ section: string; key: string; value: unknown }> = []
  const result = applyPendingNodeDataDirMigration(systemDir, {
    writeConfigField(section, key, value) {
      writes.push({ section, key, value })
    },
  })

  assert.equal(result.success, true)
  assert.equal(fs.existsSync(currentDir), false)
  assert.equal(fs.readFileSync(path.join(targetDir, 'databases', 'session.db'), 'utf-8'), 'sqlite')
  assert.equal(getPendingNodeDataDirMigration(systemDir), null)
  assert.deepEqual(writes, [
    { section: 'data', key: 'user_data_dir', value: targetDir },
    { section: 'data', key: 'electron_migration_done', value: true },
  ])
})

test('createNodeDataDirSwitch rejects data directory changes while CHATLAB_DATA_DIR is active', () => {
  const root = makeTempDir()
  const result = createNodeDataDirSwitch({
    systemDir: path.join(root, 'system'),
    currentDir: path.join(root, 'current'),
    targetDir: path.join(root, 'target'),
    migrate: true,
    envDataDir: '/env/data',
  })

  assert.equal(result.success, false)
})

test('applyPendingNodeDataDirMigrationIfNeeded skips while CHATLAB_DATA_DIR is active', () => {
  const originalEnvDir = process.env.CHATLAB_DATA_DIR
  process.env.CHATLAB_DATA_DIR = '/env/data'

  try {
    const result = applyPendingNodeDataDirMigrationIfNeeded()
    assert.equal(result.success, true)
    assert.equal(result.skipped, true)
  } finally {
    if (originalEnvDir === undefined) {
      delete process.env.CHATLAB_DATA_DIR
    } else {
      process.env.CHATLAB_DATA_DIR = originalEnvDir
    }
  }
})
