import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createPendingDataDirMigration, runPendingDataDirMigration, isExistingUserDataDir } from './dataDirSwitch'

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-data-switch-'))
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
