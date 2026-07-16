import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  CACHE_KEY_MEMBERS,
  getCache,
  setCache,
  type MembersCache,
} from '@openchatlab/node-runtime/src/cache/session-cache'
import { initDbDir } from '../core/dbCore'
import { analyzePushImport, pushImport } from './pushImport'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

test('Desktop worker push analysis uses shared semantics without creating a database', async (t) => {
  const baseDir = process.env.CHATLAB_TEST_TMPDIR ?? (fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir())
  const root = fs.mkdtempSync(path.join(baseDir, 'chatlab-worker-push-analysis-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  const dbDir = path.join(root, 'databases')
  initDbDir(dbDir, path.join(root, 'cache'), path.join(root, 'temp'), nativeBinding, path.join(root, 'logs'))

  const outcome = await analyzePushImport('worker-analysis', {
    chatlab: { version: '0.0.2', exportedAt: 1780330900 },
    meta: { name: 'Worker Push Analysis', platform: 'wechat', type: 'group' },
    members: [{ platformId: 'wxid_alice', accountName: 'Alice' }],
    messages: [{ sender: 'wxid_bob', timestamp: 1780330832, type: 0, content: 'hello' }],
  })

  assert.equal(outcome.ok, true, JSON.stringify(outcome))
  assert.equal(fs.existsSync(path.join(dbDir, 'worker-analysis.db')), false)
})

test('Desktop worker push import uses the shared writer and canonical database directory', async (t) => {
  const baseDir = process.env.CHATLAB_TEST_TMPDIR ?? (fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir())
  const root = fs.mkdtempSync(path.join(baseDir, 'chatlab-worker-push-import-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  const dbDir = path.join(root, 'databases')
  initDbDir(dbDir, path.join(root, 'cache'), path.join(root, 'temp'), nativeBinding, path.join(root, 'logs'))

  const outcome = await pushImport('worker-session', {
    chatlab: { version: '0.0.2', exportedAt: 1780330900 },
    meta: { name: 'Worker Push Import', platform: 'wechat', type: 'private' },
    members: [{ platformId: 'wxid_alice', accountName: 'Alice' }],
    messages: [
      {
        platformMessageId: 'msg-1',
        sender: 'wxid_alice',
        timestamp: 1780330832,
        type: 0,
        content: 'hello',
      },
    ],
  })

  assert.equal(outcome.ok, true, JSON.stringify(outcome))
  assert.equal(fs.existsSync(path.join(dbDir, 'worker-session.db')), true)
  assert.equal(fs.existsSync(path.join(root, 'worker-session.db')), false)
})

test('Desktop worker push import refreshes caches after duplicate-only member updates', async (t) => {
  const baseDir = process.env.CHATLAB_TEST_TMPDIR ?? (fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir())
  const root = fs.mkdtempSync(path.join(baseDir, 'chatlab-worker-push-cache-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  const cacheDir = path.join(root, 'cache')
  const queryCacheDir = path.join(cacheDir, 'query')
  initDbDir(path.join(root, 'databases'), cacheDir, path.join(root, 'temp'), nativeBinding, path.join(root, 'logs'))

  const payload = {
    chatlab: { version: '0.0.2', exportedAt: 1780330900 },
    meta: { name: 'Worker Push Import', platform: 'wechat', type: 'private' as const },
    members: [{ platformId: 'wxid_alice', accountName: 'Alice' }],
    messages: [
      {
        platformMessageId: 'msg-1',
        sender: 'wxid_alice',
        timestamp: 1780330832,
        type: 0,
        content: 'hello',
      },
    ],
  }

  const initialOutcome = await pushImport('cache-session', payload)
  assert.equal(initialOutcome.ok, true, JSON.stringify(initialOutcome))

  setCache<MembersCache>('cache-session', CACHE_KEY_MEMBERS, { members: { 1: { name: 'Alice', count: 1 } } }, cacheDir)
  setCache('cache-session', 'analysis:test', { stale: true }, queryCacheDir)

  const outcome = await pushImport('cache-session', {
    ...payload,
    members: [{ platformId: 'wxid_alice', accountName: 'Alice', groupNickname: 'Updated Alice' }],
  })

  assert.equal(outcome.ok, true, JSON.stringify(outcome))
  if (!outcome.ok) return
  assert.equal(outcome.result.batch.writtenCount, 0)
  assert.equal(outcome.result.updates.membersUpdated, 1)
  assert.equal(getCache<MembersCache>('cache-session', CACHE_KEY_MEMBERS, cacheDir)?.members[1]?.name, 'Updated Alice')
  assert.equal(getCache('cache-session', 'analysis:test', queryCacheDir), null)
})
