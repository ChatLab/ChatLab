import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { PathProvider } from '@openchatlab/core'
import {
  DatabaseManager,
  DataDirCompatibilityError,
  raiseDataDirMinRuntimeVersion,
  readDataDirCompatibilityMeta,
} from '@openchatlab/node-runtime'
import { analyzeIncrementalImport, incrementalImport } from './stream-import'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

function makeTempDir(): string {
  const baseDir = fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir()
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-cli-stream-import-'))
}

function createPathProvider(root: string): PathProvider {
  return {
    getSystemDir: () => root,
    getUserDataDir: () => path.join(root, 'data'),
    getDatabaseDir: () => path.join(root, 'data', 'databases'),
    getVectorDir: () => path.join(root, 'data', 'vector'),
    getAiDataDir: () => path.join(root, 'ai'),
    getSettingsDir: () => path.join(root, 'settings'),
    getCacheDir: () => path.join(root, 'cache'),
    getTempDir: () => path.join(root, 'temp'),
    getLogsDir: () => path.join(root, 'logs'),
    getDownloadsDir: () => path.join(root, 'downloads'),
  }
}

function writeIncrementalJsonl(filePath: string): void {
  const rows = [
    {
      _type: 'header',
      chatlab: { version: '1.0.0', exportedAt: 1780830000 },
      meta: { name: 'Incremental Chat', platform: 'qq', type: 'group' },
    },
    { _type: 'member', platformId: 'u1', accountName: 'Alice' },
    {
      _type: 'message',
      sender: 'u1',
      accountName: 'Alice',
      timestamp: 2000,
      type: 0,
      content: 'new incremental message',
      platformMessageId: 'm1',
    },
  ]
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join('\n'), 'utf-8')
}

test('incrementalImport raises the data directory gate after successful writes', async () => {
  const root = makeTempDir()
  const pathProvider = createPathProvider(root)
  const manager = new DatabaseManager(pathProvider, {
    nativeBinding,
    runtime: { version: '0.25.1', kind: 'cli' },
  })

  const db = manager.openRawSessionDatabase('existing', { create: true, initializeChatTables: true })
  db.prepare('INSERT INTO meta (name, platform, type, imported_at) VALUES (?, ?, ?, ?)').run(
    'Existing Chat',
    'qq',
    'group',
    1000
  )
  db.prepare('INSERT INTO member (platform_id, account_name) VALUES (?, ?)').run('u0', 'Existing User')
  db.close()

  const filePath = path.join(root, 'incremental.jsonl')
  writeIncrementalJsonl(filePath)

  const result = await incrementalImport(manager, 'existing', filePath)

  assert.equal(result.success, true)
  assert.equal(result.newMessageCount, 1)
  const meta = readDataDirCompatibilityMeta(pathProvider.getUserDataDir())
  assert.equal(meta?.minRuntimeVersion, '0.25.1')
  assert.equal(meta?.dataCompatibilityVersion, 1)
  assert.deepEqual(meta?.reasons, ['segment-schema'])
})

test('analyzeIncrementalImport propagates data directory compatibility errors', async () => {
  const root = makeTempDir()
  const pathProvider = createPathProvider(root)
  fs.mkdirSync(pathProvider.getDatabaseDir(), { recursive: true })
  fs.writeFileSync(path.join(pathProvider.getDatabaseDir(), 'existing.db'), 'not opened before compatibility check')
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
  const filePath = path.join(root, 'incremental.jsonl')
  writeIncrementalJsonl(filePath)

  await assert.rejects(
    () => analyzeIncrementalImport(manager, 'existing', filePath),
    (error) => error instanceof DataDirCompatibilityError && error.code === 'DATA_DIR_REQUIRES_NEWER_RUNTIME'
  )
})

test('incrementalImport honors an explicitly selected parser format', async () => {
  const root = makeTempDir()
  const pathProvider = createPathProvider(root)
  const manager = new DatabaseManager(pathProvider, {
    nativeBinding,
    runtime: { version: '0.25.1', kind: 'cli' },
  })
  const db = manager.openRawSessionDatabase('existing', { create: true, initializeChatTables: true })
  db.prepare('INSERT INTO meta (name, platform, type, imported_at) VALUES (?, ?, ?, ?)').run(
    'Existing Chat',
    'qq',
    'group',
    1000
  )
  db.close()

  const filePath = path.join(root, 'explicit-format.txt')
  writeIncrementalJsonl(filePath)
  const result = await incrementalImport(manager, 'existing', filePath, { formatId: 'chatlab-jsonl' })

  assert.equal(result.success, true)
  assert.equal(result.newMessageCount, 1)
})
