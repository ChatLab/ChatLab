import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { PathProvider } from '@openchatlab/core'
import { DatabaseManager, raiseDataDirMinRuntimeVersion, readDataDirCompatibilityMeta } from '@openchatlab/node-runtime'
import { importData } from './importer'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

function makeTempDir(): string {
  const baseDir = fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir()
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-cli-import-'))
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

test('importData raises the data directory gate after creating a current-schema database', async () => {
  const root = makeTempDir()
  fs.mkdirSync(path.join(root, 'data', 'databases'), { recursive: true })
  const manager = new DatabaseManager(createPathProvider(root), {
    nativeBinding,
    runtime: { version: '0.25.1', kind: 'cli' },
  })

  const result = await importData(
    manager,
    {
      meta: { name: 'Fresh Import', platform: 'qq', type: 'group' },
      members: [{ platformId: 'u1', accountName: 'Alice' }],
      messages: [
        {
          senderPlatformId: 'u1',
          senderAccountName: 'Alice',
          timestamp: 1000,
          type: 0,
          content: 'hello',
        },
      ],
    },
    { nativeBinding }
  )

  assert.equal(result.success, true)
  const meta = readDataDirCompatibilityMeta(path.join(root, 'data'))
  assert.equal(meta?.minRuntimeVersion, '0.25.1')
  assert.equal(meta?.dataCompatibilityVersion, 1)
  assert.deepEqual(meta?.reasons, ['segment-schema'])
})

test('importData re-checks data directory compatibility before raw database writes', async () => {
  const root = makeTempDir()
  fs.mkdirSync(path.join(root, 'data', 'databases'), { recursive: true })
  const pathProvider = createPathProvider(root)
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

  const result = await importData(
    manager,
    {
      meta: { name: 'Blocked Import', platform: 'qq', type: 'group' },
      members: [{ platformId: 'u1', accountName: 'Alice' }],
      messages: [
        {
          senderPlatformId: 'u1',
          senderAccountName: 'Alice',
          timestamp: 1000,
          type: 0,
          content: 'hello',
        },
      ],
    },
    { nativeBinding }
  )

  assert.equal(result.success, false)
  assert.match(result.error ?? '', /requires runtime version 0\.26\.0 or newer/)
  assert.equal(fs.readdirSync(path.join(root, 'data', 'databases')).filter((name) => name.endsWith('.db')).length, 0)
})
