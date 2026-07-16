import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  CHATLAB_TEMP_ROOT_ENV,
  createChatLabTempDir,
  ensureChatLabTempRoot,
  getChatLabTempScopeDir,
  removeChatLabTempDir,
  resolveChatLabTempRoot,
} from './temp-workspace'

function makeTestRoot(): string {
  return fs.mkdtempSync(path.join(process.env.CHATLAB_TEST_TMPDIR ?? os.tmpdir(), 'chatlab-temp-workspace-'))
}

test('resolveChatLabTempRoot uses /private/tmp/chatlab on macOS and the system temp directory elsewhere', () => {
  assert.equal(
    resolveChatLabTempRoot({ platform: 'darwin', systemTempDir: '/ignored', env: {} }),
    '/private/tmp/chatlab'
  )
  assert.equal(
    resolveChatLabTempRoot({ platform: 'linux', systemTempDir: '/tmp', env: {} }),
    path.resolve('/tmp/chatlab')
  )
})

test('explicit CHATLAB_TEMP_ROOT overrides the platform default', () => {
  assert.equal(
    resolveChatLabTempRoot({
      platform: 'darwin',
      systemTempDir: '/ignored',
      env: { [CHATLAB_TEMP_ROOT_ENV]: '/custom/chatlab-temp' },
    }),
    path.resolve('/custom/chatlab-temp')
  )
})

test('ensureChatLabTempRoot creates a private root and publishes it to child processes', (t) => {
  const parent = makeTestRoot()
  const root = path.join(parent, 'chatlab')
  const env: NodeJS.ProcessEnv = { [CHATLAB_TEMP_ROOT_ENV]: root }
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }))

  assert.equal(ensureChatLabTempRoot({ env }), root)
  assert.equal(env[CHATLAB_TEMP_ROOT_ENV], root)
  assert.equal(fs.statSync(root).isDirectory(), true)
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(root).mode & 0o777, 0o700)
  }
})

test('scoped temp directories are isolated and cleanup never crosses scope boundaries', (t) => {
  const parent = makeTestRoot()
  const root = path.join(parent, 'chatlab')
  const options = { env: { [CHATLAB_TEMP_ROOT_ENV]: root } }
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }))

  const first = createChatLabTempDir('imports', 'job-', options)
  const second = createChatLabTempDir('imports', 'job-', options)
  const merge = createChatLabTempDir('merge', 'job-', options)

  assert.notEqual(first, second)
  assert.equal(path.dirname(first), getChatLabTempScopeDir('imports', options))
  assert.equal(path.dirname(merge), getChatLabTempScopeDir('merge', options))

  removeChatLabTempDir(first, 'imports', options)
  assert.equal(fs.existsSync(first), false)
  assert.equal(fs.existsSync(second), true)
  assert.equal(fs.existsSync(merge), true)
  assert.throws(() => removeChatLabTempDir(merge, 'imports', options), /Refusing to remove non-owned/)
})

test('temp workspace rejects invalid scopes, prefixes, and symlink roots', (t) => {
  const parent = makeTestRoot()
  const root = path.join(parent, 'chatlab')
  const options = { env: { [CHATLAB_TEMP_ROOT_ENV]: root } }
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }))

  assert.throws(() => getChatLabTempScopeDir('../outside' as never, options), /Invalid ChatLab temp scope/)
  assert.throws(() => createChatLabTempDir('runtime', '../job-', options), /Invalid ChatLab temp prefix/)

  if (process.platform !== 'win32') {
    const target = path.join(parent, 'target')
    fs.mkdirSync(target)
    fs.symlinkSync(target, root)
    assert.throws(() => ensureChatLabTempRoot(options), /symbolic link/)
  }
})
