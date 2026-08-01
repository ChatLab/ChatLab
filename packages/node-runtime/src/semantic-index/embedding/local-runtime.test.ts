import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'
import {
  createLocalEmbeddingRuntimeManager,
  LOCAL_EMBEDDING_RUNTIME_PACKAGE,
  LOCAL_EMBEDDING_RUNTIME_VERSION,
  type LocalEmbeddingRuntimeManagerOptions,
} from './local-runtime'

function setupRuntimeTest(t: TestContext, overrides: Partial<LocalEmbeddingRuntimeManagerOptions> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-local-runtime-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const installs: Array<{ command: string; args: string[]; cwd: string }> = []
  let verifies = 0
  const manager = createLocalEmbeddingRuntimeManager({
    baseDir: root,
    installMode: 'auto',
    platform: 'test-platform',
    arch: 'test-arch',
    runInstall: async (input) => {
      installs.push(input)
      const packageDir = path.join(input.cwd, 'node_modules', '@huggingface', 'transformers')
      fs.mkdirSync(packageDir, { recursive: true })
      fs.writeFileSync(path.join(packageDir, 'package.json'), '{}\n')
    },
    verifyRuntime: async () => {
      verifies++
    },
    ...overrides,
  })
  return { root, manager, installs, getVerifyCount: () => verifies }
}

test('installs a versioned platform runtime atomically and reuses it', async (t) => {
  const fixture = setupRuntimeTest(t)

  const [firstDir, concurrentDir] = await Promise.all([
    fixture.manager.ensureInstalled(),
    fixture.manager.ensureInstalled(),
  ])
  const reusedDir = await fixture.manager.ensureInstalled()

  assert.equal(
    firstDir,
    path.join(fixture.root, `transformers-${LOCAL_EMBEDDING_RUNTIME_VERSION}`, 'test-platform-test-arch')
  )
  assert.equal(concurrentDir, firstDir)
  assert.equal(reusedDir, firstDir)
  assert.equal(fixture.installs.length, 1)
  assert.equal(fixture.getVerifyCount(), 2)
  assert.equal(fixture.manager.getStatus(), 'ready')
  assert.deepEqual(fixture.installs[0].args, [
    'install',
    '--omit=dev',
    '--no-audit',
    '--no-fund',
    '--save-exact',
    '--loglevel=error',
    '--prefix',
    fixture.installs[0].cwd,
    `${LOCAL_EMBEDDING_RUNTIME_PACKAGE}@${LOCAL_EMBEDDING_RUNTIME_VERSION}`,
  ])
  assert.equal(fs.existsSync(path.join(firstDir, 'runtime.json')), true)
  assert.equal(
    fs.readdirSync(path.dirname(firstDir)).some((name) => name.startsWith('.installing-')),
    false
  )
})

test('cleans a failed staging install and retries on the next request', async (t) => {
  let attempts = 0
  const fixture = setupRuntimeTest(t, {
    runInstall: async (input) => {
      attempts++
      if (attempts === 1) throw new Error('install failed')
      const packageDir = path.join(input.cwd, 'node_modules', '@huggingface', 'transformers')
      fs.mkdirSync(packageDir, { recursive: true })
      fs.writeFileSync(path.join(packageDir, 'package.json'), '{}\n')
    },
  })

  await assert.rejects(fixture.manager.ensureInstalled(), /install failed/)
  assert.equal(fixture.manager.getStatus(), 'error')
  const parentDir = path.dirname(fixture.manager.getRuntimeDir())
  assert.equal(
    fs.readdirSync(parentDir).some((name) => name.startsWith('.installing-')),
    false
  )

  await fixture.manager.ensureInstalled()
  assert.equal(attempts, 2)
  assert.equal(fixture.manager.getStatus(), 'ready')
})

test('preinstalled mode fails clearly instead of invoking npm', async (t) => {
  let installCalled = false
  const fixture = setupRuntimeTest(t, {
    installMode: 'preinstalled',
    runInstall: async () => {
      installCalled = true
    },
  })

  await assert.rejects(fixture.manager.ensureInstalled(), /Preinstalled local embedding runtime is missing/)

  assert.equal(installCalled, false)
  assert.equal(fixture.manager.getStatus(), 'error')
})

test('repairs an invalid managed runtime instead of keeping a broken install', async (t) => {
  const seeded = setupRuntimeTest(t)
  await seeded.manager.ensureInstalled()
  let verifyAttempts = 0
  let reinstallAttempts = 0
  const repairManager = createLocalEmbeddingRuntimeManager({
    baseDir: seeded.root,
    installMode: 'auto',
    platform: 'test-platform',
    arch: 'test-arch',
    verifyRuntime: async () => {
      verifyAttempts++
      if (verifyAttempts === 1) throw new Error('corrupt native runtime')
    },
    runInstall: async (input) => {
      reinstallAttempts++
      const packageDir = path.join(input.cwd, 'node_modules', '@huggingface', 'transformers')
      fs.mkdirSync(packageDir, { recursive: true })
      fs.writeFileSync(path.join(packageDir, 'package.json'), '{}\n')
    },
  })

  await repairManager.ensureInstalled()

  assert.equal(reinstallAttempts, 1)
  assert.equal(verifyAttempts, 3)
  assert.equal(repairManager.getStatus(), 'ready')
})
