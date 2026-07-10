import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { verifyPackagedSqlite } from './check-packaged-sqlite.mjs'

const fixtures = []
const BETTER_SQLITE_ENTRY = '/repo/node_modules/better-sqlite3/lib/index.js'

function makeFixture({ executable, binding }) {
  const distDir = mkdtempSync(join(tmpdir(), 'chatlab-packaged-sqlite-'))
  fixtures.push(distDir)

  const appDir = join(distDir, 'win-unpacked')
  const resourcesDir = join(appDir, 'resources')
  mkdirSync(join(resourcesDir, 'native'), { recursive: true })
  if (executable) writeFileSync(join(appDir, 'ChatLab.exe'), 'executable')
  if (binding) writeFileSync(join(resourcesDir, 'native', 'better_sqlite3.node'), 'binding')
  return distDir
}

test.afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true })
})

test('verifyPackagedSqlite rejects a missing packaged binding', () => {
  const distDir = makeFixture({ executable: true, binding: false })

  assert.throws(
    () =>
      verifyPackagedSqlite({
        distDir,
        betterSqliteEntry: BETTER_SQLITE_ENTRY,
        spawn: () => assert.fail('spawn must not run when the binding is missing'),
      }),
    /binding.*missing/i
  )
})

test('verifyPackagedSqlite reports Electron load failures', () => {
  const distDir = makeFixture({ executable: true, binding: true })

  assert.throws(
    () =>
      verifyPackagedSqlite({
        distDir,
        betterSqliteEntry: BETTER_SQLITE_ENTRY,
        spawn: () => ({ status: 1, stdout: '', stderr: 'NODE_MODULE_VERSION 137 requires 133' }),
      }),
    /137 requires 133/
  )
})

test('verifyPackagedSqlite accepts a real SQLite probe result', () => {
  const distDir = makeFixture({ executable: true, binding: true })
  let invocation

  const result = verifyPackagedSqlite({
    distDir,
    betterSqliteEntry: BETTER_SQLITE_ENTRY,
    spawn: (executablePath, args, options) => {
      invocation = { executablePath, args, options }
      return { status: 0, stdout: '{"abi":"133","value":1}', stderr: '' }
    },
  })

  assert.deepEqual(result, { abi: '133', value: 1 })
  assert.equal(invocation.executablePath, join(distDir, 'win-unpacked', 'ChatLab.exe'))
  assert.equal(invocation.args.at(-1), join(distDir, 'win-unpacked', 'resources', 'native', 'better_sqlite3.node'))
  assert.equal(invocation.options.env.ELECTRON_RUN_AS_NODE, '1')
})
