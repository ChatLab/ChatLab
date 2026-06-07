import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { PathProvider } from '@openchatlab/core'
import { DatabaseManager, DataDirCompatibilityError, raiseDataDirMinRuntimeVersion } from '@openchatlab/node-runtime'
import { DirectImporter } from './adapters'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

function makeTempDir(): string {
  const baseDir = fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir()
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-cli-sync-'))
}

function createPathProvider(root: string): PathProvider {
  return {
    getSystemDir: () => root,
    getUserDataDir: () => path.join(root, 'data'),
    getDatabaseDir: () => path.join(root, 'data', 'databases'),
    getAiDataDir: () => path.join(root, 'ai'),
    getSettingsDir: () => path.join(root, 'settings'),
    getCacheDir: () => path.join(root, 'cache'),
    getTempDir: () => path.join(root, 'temp'),
    getLogsDir: () => path.join(root, 'logs'),
    getDownloadsDir: () => path.join(root, 'downloads'),
  }
}

test('DirectImporter.sessionExists preserves session DBs when compatibility gate blocks access', () => {
  const root = makeTempDir()
  const pathProvider = createPathProvider(root)
  const dbDir = pathProvider.getDatabaseDir()
  fs.mkdirSync(dbDir, { recursive: true })
  const dbPath = path.join(dbDir, 'blocked.db')
  fs.writeFileSync(dbPath, 'sqlite content is not opened before the compatibility check', 'utf-8')
  raiseDataDirMinRuntimeVersion(pathProvider, {
    minRuntimeVersion: '0.26.0',
    dataCompatibilityVersion: 2,
    reason: 'future-schema',
    runtime: { version: '0.26.0', kind: 'desktop' },
    module: 'future-migration',
    now: () => 1780830000,
  })

  const manager = new DatabaseManager(pathProvider, {
    nativeBinding,
    runtime: { version: '0.25.1', kind: 'cli' },
  })
  const importer = new DirectImporter(manager)

  assert.throws(
    () => importer.sessionExists('blocked'),
    (error) => error instanceof DataDirCompatibilityError && error.code === 'DATA_DIR_REQUIRES_NEWER_RUNTIME'
  )
  assert.equal(fs.existsSync(dbPath), true)
})
