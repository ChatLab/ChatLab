import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  applyPendingNodeDataDirMigration,
  copyDirMerge,
  createPendingDataDirMigration,
  createNodeDataDirSwitch,
  deletePendingDataDirCleanup,
  dismissPendingDataDirCleanupNotice,
  getPendingDataDirCleanups,
  getPendingNodeDataDirMigration,
  isExistingUserDataDir,
  registerPendingDataDirCleanup,
  runPendingDataDirMigration,
} from './data-dir-switch'
import { applyPendingNodeDataDirMigrationIfNeeded, NodePathProvider } from './node-path-provider'

function makeTempDir(): string {
  const baseDir = process.env.CHATLAB_TEST_TMPDIR ?? (fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir())
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
  assert.equal(pending.deleteSourceOnSuccess, false)
  assert.match(pending.createdAt, /^\d{4}-\d{2}-\d{2}T/)
})

test('runPendingDataDirMigration writes config only after copy succeeds', () => {
  const root = makeTempDir()
  const source = path.join(root, 'source')
  const target = path.join(root, 'target')
  writeFile(path.join(source, 'databases', 'session.db'), 'sqlite')

  let configuredDir = source
  let pendingCleared = false
  let pendingCleanup: { sourceDir: string; targetDir: string } | null = null

  const result = runPendingDataDirMigration(
    createPendingDataDirMigration({ from: source, to: target, migrate: true, targetWasEmpty: true }),
    {
      writeUserDataDir(dir) {
        configuredDir = dir
      },
      clearPendingMigration() {
        pendingCleared = true
      },
      recordPendingCleanup(sourceDir, targetDir) {
        pendingCleanup = { sourceDir, targetDir }
      },
    }
  )

  assert.equal(result.success, true)
  assert.equal(configuredDir, target)
  assert.equal(pendingCleared, true)
  assert.deepEqual(pendingCleanup, { sourceDir: source, targetDir: target })
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

test('applyPendingNodeDataDirMigration preserves old data directory for manual cleanup', () => {
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
  assert.equal(fs.existsSync(currentDir), true)
  assert.equal(fs.readFileSync(path.join(targetDir, 'databases', 'session.db'), 'utf-8'), 'sqlite')
  assert.equal(getPendingNodeDataDirMigration(systemDir), null)
  assert.deepEqual(
    getPendingDataDirCleanups(systemDir).map(({ sourceDir, targetDir: cleanupTargetDir, noticeDismissed }) => ({
      sourceDir,
      targetDir: cleanupTargetDir,
      noticeDismissed,
    })),
    [{ sourceDir: currentDir, targetDir, noticeDismissed: false }]
  )
  assert.deepEqual(writes, [
    { section: 'data', key: 'user_data_dir', value: targetDir },
    { section: 'data', key: 'electron_migration_done', value: true },
  ])
})

test('retrying a partially failed migration never deletes the newer source database', () => {
  const root = makeTempDir()
  const systemDir = path.join(root, 'system')
  const source = path.join(root, 'source')
  const target = path.join(root, 'target')
  const sourceDb = path.join(source, 'databases', 'session.db')
  const targetDb = path.join(target, 'databases', 'session.db')
  writeFile(sourceDb, 'before-first-attempt')

  const pending = createPendingDataDirMigration({ from: source, to: target, migrate: true, targetWasEmpty: true })
  const firstResult = runPendingDataDirMigration(pending, {
    copyDirMerge(src, dest, mkdir) {
      const stats = copyDirMerge(src, dest, mkdir)
      stats.errors.push('simulated later-file failure')
      return stats
    },
    writeUserDataDir() {
      // The failed attempt must not commit the target path.
    },
    clearPendingMigration() {
      // The failed attempt must keep the pending task.
    },
  })
  assert.equal(firstResult.success, false)

  writeFile(sourceDb, 'new-data-after-failed-attempt')
  const secondResult = runPendingDataDirMigration(pending, {
    writeUserDataDir() {
      // Config persistence is covered by the adapter-level test.
    },
    clearPendingMigration() {
      // Pending task persistence is covered by the adapter-level test.
    },
    recordPendingCleanup(sourceDir, targetDir) {
      registerPendingDataDirCleanup(systemDir, { sourceDir, targetDir })
    },
  })

  assert.equal(secondResult.success, true)
  assert.equal(fs.readFileSync(sourceDb, 'utf-8'), 'new-data-after-failed-attempt')
  assert.equal(fs.readFileSync(targetDb, 'utf-8'), 'before-first-attempt')
  assert.equal(getPendingDataDirCleanups(systemDir)[0]?.sourceDir, source)
})

test('pending data directory cleanup can be dismissed and deleted explicitly', () => {
  const root = makeTempDir()
  const systemDir = path.join(root, 'system')
  const currentDir = path.join(root, 'current')
  const targetDir = path.join(root, 'target')
  writeFile(path.join(currentDir, '.chatlab'), 'ChatLab Data Directory')
  writeFile(path.join(currentDir, 'databases', 'session.db'), 'sqlite')

  const switchResult = createNodeDataDirSwitch({ systemDir, currentDir, targetDir, migrate: true })
  assert.equal(switchResult.success, true)
  assert.equal(
    applyPendingNodeDataDirMigration(systemDir, {
      writeConfigField() {
        // Config persistence is covered by the preceding adapter-level test.
      },
    }).success,
    true
  )

  const [cleanup] = getPendingDataDirCleanups(systemDir)
  assert.ok(cleanup)
  assert.equal(dismissPendingDataDirCleanupNotice(systemDir, cleanup.id), true)
  assert.equal(getPendingDataDirCleanups(systemDir)[0]?.noticeDismissed, true)

  const deleteResult = deletePendingDataDirCleanup(systemDir, targetDir, cleanup.id)
  assert.equal(deleteResult.success, true)
  assert.equal(fs.existsSync(currentDir), false)
  assert.deepEqual(getPendingDataDirCleanups(systemDir), [])
})

test('manual cleanup refuses directories that are still in use or no longer contain ChatLab data', () => {
  const root = makeTempDir()
  const systemDir = path.join(root, 'system')
  const sourceDir = path.join(root, 'source')
  const targetDir = path.join(root, 'target')
  writeFile(path.join(sourceDir, '.chatlab'), 'ChatLab Data Directory')
  writeFile(path.join(sourceDir, 'databases', 'session.db'), 'sqlite')

  const inUse = registerPendingDataDirCleanup(systemDir, { sourceDir, targetDir })
  assert.ok(inUse)
  assert.equal(deletePendingDataDirCleanup(systemDir, sourceDir, inUse.id).success, false)
  assert.equal(fs.existsSync(sourceDir), true)

  fs.rmSync(path.join(sourceDir, '.chatlab'))
  fs.rmSync(path.join(sourceDir, 'databases'), { recursive: true })
  writeFile(path.join(sourceDir, 'personal.txt'), 'keep me')
  const unrecognizedResult = deletePendingDataDirCleanup(systemDir, targetDir, inUse.id)
  assert.equal(unrecognizedResult.success, false)
  assert.equal(fs.readFileSync(path.join(sourceDir, 'personal.txt'), 'utf-8'), 'keep me')
})

test('switching back to a preserved directory removes it from cleanup candidates', () => {
  const root = makeTempDir()
  const systemDir = path.join(root, 'system')
  const firstDir = path.join(root, 'first')
  const secondDir = path.join(root, 'second')

  registerPendingDataDirCleanup(systemDir, { sourceDir: firstDir, targetDir: secondDir })
  registerPendingDataDirCleanup(systemDir, { sourceDir: secondDir, targetDir: firstDir })

  assert.deepEqual(
    getPendingDataDirCleanups(systemDir).map((cleanup) => cleanup.sourceDir),
    [secondDir]
  )
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
