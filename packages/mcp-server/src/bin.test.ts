import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DataDirCompatibilityError, raiseDataDirMinRuntimeVersion } from '@openchatlab/node-runtime'
import { initStandaloneMcpRuntime, resolveMcpLocale } from './standalone-runtime'

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

test('resolveMcpLocale prefers the configured language and falls back to the system locale', () => {
  const cases: Array<{ lang: string; systemLocale: string; expected: string }> = [
    { lang: 'zh-CN', systemLocale: 'en-US', expected: 'zh-CN' },
    { lang: '', systemLocale: 'en-US', expected: 'en-US' },
    { lang: '', systemLocale: 'zh-CN', expected: 'zh-CN' },
  ]

  for (const { lang, systemLocale, expected } of cases) {
    assert.equal(resolveMcpLocale({ locale: { lang } }, systemLocale), expected, `${lang || '(empty)'}/${systemLocale}`)
  }
})
