import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { PathProvider } from '@openchatlab/core'
import { DatabaseManager } from '../../database-manager'
import { createDatabaseManagerAdapter } from './database-manager-adapter'
import { getContactsFactsCacheDir } from '../contacts/paths'
import { getGlobalInsightDir, getGlobalInsightFactsCacheDir } from '../global-insight/paths'

function makeTempDir(): string {
  const baseDir = process.env.CHATLAB_TEST_TMPDIR ?? (fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir())
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-db-adapter-'))
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

test('DatabaseManager adapter deletes session database sidecar files and caches', () => {
  const root = makeTempDir()
  const pathProvider = createPathProvider(root)
  const manager = new DatabaseManager(pathProvider, { allowMissingRuntimeForTests: true })
  const adapter = createDatabaseManagerAdapter(manager)

  const sessionId = 'synced-session'
  const dbPath = manager.getDbPath(sessionId)
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  for (const suffix of ['', '-wal', '-shm']) {
    fs.writeFileSync(dbPath + suffix, 'stale-data', 'utf-8')
  }

  const cachePath = path.join(pathProvider.getCacheDir(), `${sessionId}.cache.json`)
  const queryCachePath = path.join(pathProvider.getCacheDir(), 'query', `${sessionId}.cache.json`)
  const contactsFactsCachePath = path.join(
    getContactsFactsCacheDir(pathProvider.getUserDataDir()),
    `${sessionId}.cache.json`
  )
  const globalInsightFactsCachePath = path.join(
    getGlobalInsightFactsCacheDir(pathProvider.getUserDataDir()),
    `${sessionId}.cache.json`
  )
  const annualSummaryYearSnapshotPath = path.join(
    getGlobalInsightDir(pathProvider.getUserDataDir()),
    'annual-summary-year-2026.json'
  )
  const annualSummaryRecentSnapshotPath = path.join(
    getGlobalInsightDir(pathProvider.getUserDataDir()),
    'annual-summary-recent-365.json'
  )
  fs.mkdirSync(path.dirname(cachePath), { recursive: true })
  fs.mkdirSync(path.dirname(queryCachePath), { recursive: true })
  fs.mkdirSync(path.dirname(contactsFactsCachePath), { recursive: true })
  fs.mkdirSync(path.dirname(globalInsightFactsCachePath), { recursive: true })
  fs.mkdirSync(path.dirname(annualSummaryYearSnapshotPath), { recursive: true })
  fs.writeFileSync(cachePath, '{}', 'utf-8')
  fs.writeFileSync(queryCachePath, '{}', 'utf-8')
  fs.writeFileSync(contactsFactsCachePath, '{}', 'utf-8')
  fs.writeFileSync(globalInsightFactsCachePath, '{}', 'utf-8')
  fs.writeFileSync(annualSummaryYearSnapshotPath, '{}', 'utf-8')
  fs.writeFileSync(annualSummaryRecentSnapshotPath, '{}', 'utf-8')

  assert.equal(adapter.deleteSessionFile(sessionId), true)
  assert.equal(fs.existsSync(dbPath), false)
  assert.equal(fs.existsSync(dbPath + '-wal'), false)
  assert.equal(fs.existsSync(dbPath + '-shm'), false)
  assert.equal(fs.existsSync(cachePath), false)
  assert.equal(fs.existsSync(queryCachePath), false)
  assert.equal(fs.existsSync(contactsFactsCachePath), false)
  assert.equal(fs.existsSync(globalInsightFactsCachePath), false)
  assert.equal(fs.existsSync(annualSummaryYearSnapshotPath), false)
  assert.equal(fs.existsSync(annualSummaryRecentSnapshotPath), false)
})
