import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ImportInProgressError, withDataDirImportLock } from './import-lock'

function makeTempDir(): string {
  const baseDir = process.env.CHATLAB_TEST_TMPDIR ?? (fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir())
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-import-lock-'))
}

test('rejects a second import for the same data directory and releases after completion', async (t) => {
  const dataDir = makeTempDir()
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }))

  let releaseFirst!: () => void
  const firstCanFinish = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  let firstStarted!: () => void
  const firstDidStart = new Promise<void>((resolve) => {
    firstStarted = resolve
  })

  const first = withDataDirImportLock(dataDir, async () => {
    firstStarted()
    await firstCanFinish
    return 'first'
  })
  await firstDidStart

  await assert.rejects(
    () => withDataDirImportLock(dataDir, async () => 'second'),
    (error: unknown) => error instanceof ImportInProgressError && error.code === 'IMPORT_IN_PROGRESS'
  )

  releaseFirst()
  assert.equal(await first, 'first')
  assert.equal(await withDataDirImportLock(dataDir, async () => 'third'), 'third')
})

test('allows imports in different data directories', async (t) => {
  const firstDir = makeTempDir()
  const secondDir = makeTempDir()
  t.after(() => {
    fs.rmSync(firstDir, { recursive: true, force: true })
    fs.rmSync(secondDir, { recursive: true, force: true })
  })

  let releaseFirst!: () => void
  const firstCanFinish = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  let firstStarted!: () => void
  const firstDidStart = new Promise<void>((resolve) => {
    firstStarted = resolve
  })

  const first = withDataDirImportLock(firstDir, async () => {
    firstStarted()
    await firstCanFinish
  })
  await firstDidStart

  assert.equal(await withDataDirImportLock(secondDir, async () => 'second'), 'second')
  releaseFirst()
  await first
})

test('recovers a lock left by a process that is no longer running', async (t) => {
  const dataDir = makeTempDir()
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }))

  fs.writeFileSync(
    path.join(dataDir, '.chatlab-import.lock'),
    JSON.stringify({ pid: 2_147_483_647, token: 'stale', startedAt: 1 }),
    'utf-8'
  )

  assert.equal(await withDataDirImportLock(dataDir, async () => 'recovered'), 'recovered')
})
