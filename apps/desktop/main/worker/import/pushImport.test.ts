import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { initDbDir } from '../core/dbCore'
import { pushImport } from './pushImport'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

test('Desktop worker push import uses the shared writer and canonical database directory', async (t) => {
  const baseDir = fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir()
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
