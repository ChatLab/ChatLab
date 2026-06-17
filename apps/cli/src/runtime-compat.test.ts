import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { PathProvider } from '@openchatlab/core'
import { assertCliDataDirCompatible } from './runtime-compat'

function makeTempDir(): string {
  const baseDir = fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir()
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-cli-compat-'))
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

test('assertCliDataDirCompatible formats a startup error for older CLI runtimes', () => {
  const userDataDir = makeTempDir()
  fs.writeFileSync(
    path.join(userDataDir, '.chatlab-meta.json'),
    JSON.stringify({
      formatVersion: 1,
      minRuntimeVersion: '999.0.0',
      dataCompatibilityVersion: 1,
      reasons: ['segment-schema'],
      updatedBy: { runtime: 'desktop', module: 'chat-db-migration', version: '999.0.0' },
      updatedAt: 1780830000,
    }),
    'utf-8'
  )

  assert.throws(
    () => assertCliDataDirCompatible(makePathProvider(userDataDir), 'cli', { version: '0.25.0' }),
    (error) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /requires ChatLab 999\.0\.0 or newer/)
      assert.match(error.message, /Current cli version: 0\.25\.0/)
      assert.match(error.message, new RegExp(userDataDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      assert.match(error.message, /npm install -g chatlab-cli@latest/)
      return true
    }
  )
})
