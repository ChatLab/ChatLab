import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  applyPendingNodeDataDirMigration,
  copyUserScopedSystemDirs,
  createPendingDataDirMigration,
  createNodeDataDirSwitch,
  getPendingNodeDataDirMigration,
  isExistingUserDataDir,
  runPendingDataDirMigration,
} from './data-dir-switch'
import { applyPendingNodeDataDirMigrationIfNeeded, NodePathProvider } from './node-path-provider'

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

test('createNodeDataDirSwitch accepts existing CLI data directories without marker', () => {
  const root = makeTempDir()
  const currentDir = path.join(root, 'current')
  const targetDir = path.join(root, 'previous-cli-data')
  writeFile(path.join(currentDir, 'databases', 'current.db'), 'sqlite')
  writeFile(path.join(targetDir, 'databases', 'session.db'), 'sqlite')

  const result = createNodeDataDirSwitch({
    systemDir: path.join(root, 'system'),
    currentDir,
    targetDir,
    migrate: true,
  })

  assert.equal(result.success, true)
  assert.equal(result.requiresRelaunch, true)
})

test('NodePathProvider marks CLI-created data directories', () => {
  const root = makeTempDir()
  const dataDir = path.join(root, 'data')
  const provider = new NodePathProvider(dataDir)

  provider.ensureAllDirs()

  assert.equal(fs.readFileSync(path.join(dataDir, '.chatlab'), 'utf-8'), 'ChatLab Data Directory')
})

test('NodePathProvider keeps AI data, cache, and logs under the configured data directory', () => {
  const root = makeTempDir()
  const dataDir = path.join(root, 'data')
  const provider = new NodePathProvider(dataDir)

  assert.equal(provider.getAiDataDir(), path.join(dataDir, 'ai'))
  assert.equal(provider.getCacheDir(), path.join(dataDir, 'cache'))
  assert.equal(provider.getLogsDir(), path.join(dataDir, 'logs'))
})

test('copyUserScopedSystemDirs copies legacy AI data, cache, and logs into the user data directory', () => {
  const root = makeTempDir()
  const systemDir = path.join(root, 'system')
  const dataDir = path.join(root, 'data')
  writeFile(path.join(systemDir, 'ai', 'ai-chats.db'), 'ai')
  writeFile(path.join(systemDir, 'cache', 'cache.db'), 'cache')
  writeFile(path.join(systemDir, 'logs', 'app.log'), 'log')

  const result = copyUserScopedSystemDirs(systemDir, dataDir)

  assert.equal(result.errors.length, 0)
  assert.equal(fs.readFileSync(path.join(dataDir, 'ai', 'ai-chats.db'), 'utf-8'), 'ai')
  assert.equal(fs.readFileSync(path.join(dataDir, 'cache', 'cache.db'), 'utf-8'), 'cache')
  assert.equal(fs.readFileSync(path.join(dataDir, 'logs', 'app.log'), 'utf-8'), 'log')
})

test('copyUserScopedSystemDirs is a no-op when legacy system dirs are missing', () => {
  const root = makeTempDir()
  const systemDir = path.join(root, 'system')
  const dataDir = path.join(root, 'data')

  const result = copyUserScopedSystemDirs(systemDir, dataDir)

  assert.deepEqual(result, { copied: 0, skipped: 0, errors: [] })
  assert.equal(fs.existsSync(dataDir), false)
})

test('copyUserScopedSystemDirs is idempotent', () => {
  const root = makeTempDir()
  const systemDir = path.join(root, 'system')
  const dataDir = path.join(root, 'data')
  writeFile(path.join(systemDir, 'ai', 'ai-chats.db'), 'ai')
  writeFile(path.join(systemDir, 'cache', 'cache.db'), 'cache')
  writeFile(path.join(systemDir, 'logs', 'app.log'), 'log')

  const first = copyUserScopedSystemDirs(systemDir, dataDir)
  const second = copyUserScopedSystemDirs(systemDir, dataDir)

  assert.equal(first.errors.length, 0)
  assert.equal(first.copied, 3)
  assert.deepEqual(second, { copied: 0, skipped: 3, errors: [] })
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

test('applyPendingNodeDataDirMigration includes legacy AI data, cache, and logs in the switched data directory', () => {
  const root = makeTempDir()
  const systemDir = path.join(root, 'system')
  const currentDir = path.join(root, 'current')
  const targetDir = path.join(root, 'target')
  writeFile(path.join(currentDir, '.chatlab'), 'ChatLab Data Directory')
  writeFile(path.join(currentDir, 'databases', 'session.db'), 'sqlite')
  writeFile(path.join(systemDir, 'ai', 'ai-chats.db'), 'ai')
  writeFile(path.join(systemDir, 'cache', 'cache.db'), 'cache')
  writeFile(path.join(systemDir, 'logs', 'app.log'), 'log')

  const switchResult = createNodeDataDirSwitch({ systemDir, currentDir, targetDir, migrate: true })
  assert.equal(switchResult.success, true)

  const writes: Array<{ section: string; key: string; value: unknown }> = []
  const result = applyPendingNodeDataDirMigration(systemDir, {
    writeConfigField(section, key, value) {
      writes.push({ section, key, value })
    },
  })

  assert.equal(result.success, true)
  assert.equal(fs.readFileSync(path.join(targetDir, 'databases', 'session.db'), 'utf-8'), 'sqlite')
  assert.equal(fs.readFileSync(path.join(targetDir, 'ai', 'ai-chats.db'), 'utf-8'), 'ai')
  assert.equal(fs.readFileSync(path.join(targetDir, 'cache', 'cache.db'), 'utf-8'), 'cache')
  assert.equal(fs.readFileSync(path.join(targetDir, 'logs', 'app.log'), 'utf-8'), 'log')
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
