import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { startHttpServer, stopHttpServer } from './http'
import { initMcpRuntime } from './mcp'

function makeTempDir(): string {
  const baseDir = process.env.CHATLAB_TEST_TMPDIR ?? (fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir())
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-cli-startup-'))
}

function writeIncompatibleMeta(userDataDir: string): void {
  fs.mkdirSync(userDataDir, { recursive: true })
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
}

async function withDataDirEnv<T>(userDataDir: string, fn: () => Promise<T> | T): Promise<T> {
  const previousDataDir = process.env.CHATLAB_DATA_DIR
  const previousOverride = process.env.CHATLAB_ALLOW_INCOMPATIBLE_DATA_DIR
  process.env.CHATLAB_DATA_DIR = userDataDir
  delete process.env.CHATLAB_ALLOW_INCOMPATIBLE_DATA_DIR

  try {
    return await fn()
  } finally {
    if (previousDataDir === undefined) {
      delete process.env.CHATLAB_DATA_DIR
    } else {
      process.env.CHATLAB_DATA_DIR = previousDataDir
    }

    if (previousOverride === undefined) {
      delete process.env.CHATLAB_ALLOW_INCOMPATIBLE_DATA_DIR
    } else {
      process.env.CHATLAB_ALLOW_INCOMPATIBLE_DATA_DIR = previousOverride
    }
  }
}

test('startHttpServer fails before serving when data directory requires a newer runtime', async () => {
  const userDataDir = makeTempDir()
  writeIncompatibleMeta(userDataDir)

  await withDataDirEnv(userDataDir, async () => {
    await assert.rejects(
      () => startHttpServer({ port: 0, host: '127.0.0.1', token: 'test_token', requireAuth: false }),
      /requires ChatLab 999\.0\.0 or newer/
    )
  })

  await stopHttpServer()
})

test('initMcpRuntime fails before starting MCP when data directory requires a newer runtime', async () => {
  const userDataDir = makeTempDir()
  writeIncompatibleMeta(userDataDir)

  await withDataDirEnv(userDataDir, () => {
    assert.throws(() => initMcpRuntime(), /requires ChatLab 999\.0\.0 or newer/)
  })
})
