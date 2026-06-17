import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { PathProvider } from '@openchatlab/core'
import { assertDesktopDataDirCompatible, resolveDesktopAppVersion } from './runtime-compat'

function makeTempDir(): string {
  const baseDir = fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir()
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-desktop-compat-'))
}

function makePathProvider(userDataDir: string): PathProvider {
  return {
    getSystemDir: () => path.join(userDataDir, '..', 'system'),
    getUserDataDir: () => userDataDir,
    getDatabaseDir: () => path.join(userDataDir, 'databases'),
    getVectorDir: () => path.join(userDataDir, 'vector'),
    getAiDataDir: () => path.join(userDataDir, '..', 'system', 'ai'),
    getSettingsDir: () => path.join(userDataDir, '..', 'system', 'settings'),
    getCacheDir: () => path.join(userDataDir, '..', 'system', 'cache'),
    getTempDir: () => path.join(userDataDir, '..', 'system', 'temp'),
    getLogsDir: () => path.join(userDataDir, '..', 'system', 'logs'),
    getDownloadsDir: () => path.join(userDataDir, '..', 'downloads'),
  }
}

test('resolveDesktopAppVersion falls back to bundled app version when Electron reports 0.0.0', () => {
  assert.equal(resolveDesktopAppVersion('0.0.0', '0.25.1'), '0.25.1')
})

test('assertDesktopDataDirCompatible accepts a gated data directory with the bundled fallback version', () => {
  const userDataDir = makeTempDir()
  fs.writeFileSync(
    path.join(userDataDir, '.chatlab-meta.json'),
    JSON.stringify({
      formatVersion: 1,
      minRuntimeVersion: '0.25.1',
      dataCompatibilityVersion: 1,
      reasons: ['segment-schema'],
      updatedBy: { runtime: 'cli', module: 'chat-db-migration', version: '0.25.1' },
      updatedAt: 1780830000,
    }),
    'utf-8'
  )

  assert.doesNotThrow(() =>
    assertDesktopDataDirCompatible(makePathProvider(userDataDir), resolveDesktopAppVersion('0.0.0', '0.25.1'))
  )
})

test('assertDesktopDataDirCompatible formats a startup error for older desktop runtimes', () => {
  const userDataDir = makeTempDir()
  fs.writeFileSync(
    path.join(userDataDir, '.chatlab-meta.json'),
    JSON.stringify({
      formatVersion: 1,
      minRuntimeVersion: '999.0.0',
      dataCompatibilityVersion: 1,
      reasons: ['segment-schema'],
      updatedBy: { runtime: 'cli', module: 'chat-db-migration', version: '999.0.0' },
      updatedAt: 1780830000,
    }),
    'utf-8'
  )

  assert.throws(
    () => assertDesktopDataDirCompatible(makePathProvider(userDataDir), '0.25.0'),
    (error) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /requires ChatLab 999\.0\.0 or newer/)
      assert.match(error.message, /Current desktop version: 0\.25\.0/)
      assert.match(error.message, new RegExp(userDataDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      assert.match(error.message, /upgrade ChatLab desktop/)
      return true
    }
  )
})
