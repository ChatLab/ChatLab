import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DataDirCompatibilityError, raiseDataDirMinRuntimeVersion } from '@openchatlab/node-runtime'
import { initStandaloneMcpRuntime } from './standalone-runtime'

function makeTempDir(): string {
  const baseDir = process.env.CHATLAB_TEST_TMPDIR ?? (fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir())
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-mcp-bin-'))
}

test('initStandaloneMcpRuntime rejects incompatible data directories before stdio startup', () => {
  const userDataDir = makeTempDir()
  const pathProvider = initStandaloneMcpRuntime('0.26.0', userDataDir).pathProvider
  raiseDataDirMinRuntimeVersion(pathProvider, {
    minRuntimeVersion: '0.26.0',
    dataCompatibilityVersion: 2,
    reason: 'future-schema',
    runtime: { version: '0.26.0', kind: 'desktop' },
    module: 'future-migration',
    now: () => 1780830000,
  })

  assert.throws(
    () => initStandaloneMcpRuntime('0.25.1', userDataDir),
    (error) => error instanceof DataDirCompatibilityError && error.code === 'DATA_DIR_REQUIRES_NEWER_RUNTIME'
  )
})
