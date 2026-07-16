import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { PathProvider } from '@openchatlab/core'
import {
  assertDataDirCompatible,
  DataDirCompatibilityError,
  raiseDataDirMinRuntimeVersion,
  readDataDirCompatibilityMeta,
} from './data-dir-compat'

function makeTempDir(): string {
  const baseDir = process.env.CHATLAB_TEST_TMPDIR ?? (fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir())
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-data-compat-'))
}

function makePathProvider(userDataDir: string): PathProvider {
  return {
    getSystemDir: () => path.join(userDataDir, '..', 'system'),
    getUserDataDir: () => userDataDir,
    getDatabaseDir: () => path.join(userDataDir, 'databases'),
    getVectorDir: () => path.join(userDataDir, 'vector'),
    getAiDataDir: () => path.join(userDataDir, '..', 'system', 'ai'),
    getSettingsDir: () => path.join(userDataDir, '..', 'system', 'settings'),
    getCacheDir: () => path.join(userDataDir, '..', 'system', 'cache'),
    getTempDir: () => path.join(userDataDir, '..', 'system', 'temp'),
    getLogsDir: () => path.join(userDataDir, '..', 'system', 'logs'),
    getDownloadsDir: () => path.join(userDataDir, '..', 'downloads'),
  }
}

function writeMeta(userDataDir: string, meta: unknown): void {
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.writeFileSync(path.join(userDataDir, '.chatlab-meta.json'), JSON.stringify(meta, null, 2), 'utf-8')
}

function withOverride<T>(value: string | undefined, fn: () => T): T {
  const previous = process.env.CHATLAB_ALLOW_INCOMPATIBLE_DATA_DIR
  if (value === undefined) {
    delete process.env.CHATLAB_ALLOW_INCOMPATIBLE_DATA_DIR
  } else {
    process.env.CHATLAB_ALLOW_INCOMPATIBLE_DATA_DIR = value
  }

  try {
    return fn()
  } finally {
    if (previous === undefined) {
      delete process.env.CHATLAB_ALLOW_INCOMPATIBLE_DATA_DIR
    } else {
      process.env.CHATLAB_ALLOW_INCOMPATIBLE_DATA_DIR = previous
    }
  }
}

test('missing data dir compatibility meta is compatible', () => {
  const userDataDir = makeTempDir()
  const provider = makePathProvider(userDataDir)

  assert.equal(readDataDirCompatibilityMeta(userDataDir), null)
  assert.doesNotThrow(() => {
    assertDataDirCompatible(provider, { version: '0.25.1', kind: 'cli' })
  })
})

test('current runtime satisfying minRuntimeVersion is compatible', () => {
  const userDataDir = makeTempDir()
  writeMeta(userDataDir, {
    formatVersion: 1,
    minRuntimeVersion: '0.25.1',
    dataCompatibilityVersion: 1,
    reasons: ['segment-schema'],
    updatedBy: { runtime: 'cli', module: 'chat-db-migration', version: '0.25.1' },
    updatedAt: 1780830000,
  })

  assert.doesNotThrow(() => {
    assertDataDirCompatible(makePathProvider(userDataDir), { version: '0.25.1', kind: 'desktop' })
  })
})

test('prerelease current runtime satisfying stable minRuntimeVersion is compatible', () => {
  const userDataDir = makeTempDir()
  writeMeta(userDataDir, {
    formatVersion: 1,
    minRuntimeVersion: '0.25.1',
    dataCompatibilityVersion: 1,
    reasons: ['segment-schema'],
    updatedBy: { runtime: 'cli', module: 'chat-db-migration', version: '0.25.1' },
    updatedAt: 1780830000,
  })

  assert.doesNotThrow(() => {
    assertDataDirCompatible(makePathProvider(userDataDir), { version: '0.26.4-beta.1', kind: 'desktop' })
  })
})

test('prerelease current runtime is compared by its stable core version', () => {
  const equalDir = makeTempDir()
  writeMeta(equalDir, {
    formatVersion: 1,
    minRuntimeVersion: '0.26.4',
    dataCompatibilityVersion: 1,
    reasons: ['segment-schema'],
    updatedBy: { runtime: 'cli', module: 'chat-db-migration', version: '0.26.4' },
    updatedAt: 1780830000,
  })

  assert.doesNotThrow(() => {
    assertDataDirCompatible(makePathProvider(equalDir), { version: '0.26.4-beta.1', kind: 'desktop' })
  })

  const newerDir = makeTempDir()
  writeMeta(newerDir, {
    formatVersion: 1,
    minRuntimeVersion: '0.26.5',
    dataCompatibilityVersion: 1,
    reasons: ['segment-schema'],
    updatedBy: { runtime: 'cli', module: 'chat-db-migration', version: '0.26.5' },
    updatedAt: 1780830000,
  })

  assert.throws(
    () => assertDataDirCompatible(makePathProvider(newerDir), { version: '0.26.4-beta.1', kind: 'desktop' }),
    (error) =>
      error instanceof DataDirCompatibilityError &&
      error.code === 'DATA_DIR_REQUIRES_NEWER_RUNTIME' &&
      error.currentVersion === '0.26.4-beta.1' &&
      error.minRuntimeVersion === '0.26.5'
  )
})

test('current runtime below minRuntimeVersion is blocked', () => {
  const userDataDir = makeTempDir()
  writeMeta(userDataDir, {
    formatVersion: 1,
    minRuntimeVersion: '0.25.1',
    dataCompatibilityVersion: 1,
    reasons: ['segment-schema'],
    updatedBy: { runtime: 'desktop', module: 'chat-db-migration', version: '0.25.1' },
    updatedAt: 1780830000,
  })

  assert.throws(
    () => {
      assertDataDirCompatible(makePathProvider(userDataDir), { version: '0.25.0', kind: 'cli' })
    },
    (error) =>
      error instanceof DataDirCompatibilityError &&
      error.code === 'DATA_DIR_REQUIRES_NEWER_RUNTIME' &&
      error.minRuntimeVersion === '0.25.1' &&
      error.currentVersion === '0.25.0' &&
      error.userDataDir === userDataDir
  )
})

test('override bypasses only version insufficiency and emits a warning', () => {
  const userDataDir = makeTempDir()
  const warnings: string[] = []
  writeMeta(userDataDir, {
    formatVersion: 1,
    minRuntimeVersion: '0.25.1',
    dataCompatibilityVersion: 1,
    reasons: ['segment-schema'],
    updatedBy: { runtime: 'desktop', module: 'chat-db-migration', version: '0.25.1' },
    updatedAt: 1780830000,
  })

  withOverride('1', () => {
    assert.doesNotThrow(() => {
      assertDataDirCompatible(
        makePathProvider(userDataDir),
        { version: '0.25.0', kind: 'cli' },
        {
          warn: (message) => warnings.push(message),
        }
      )
    })
  })

  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /CHATLAB_ALLOW_INCOMPATIBLE_DATA_DIR=1/)
  assert.match(warnings[0], /0\.25\.0/)
  assert.match(warnings[0], /0\.25\.1/)
  assert.match(warnings[0], new RegExp(userDataDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})

test('override does not bypass malformed current runtime versions', () => {
  const userDataDir = makeTempDir()
  writeMeta(userDataDir, {
    formatVersion: 1,
    minRuntimeVersion: '0.25.1',
    dataCompatibilityVersion: 1,
    reasons: ['segment-schema'],
    updatedBy: { runtime: 'desktop', module: 'chat-db-migration', version: '0.25.1' },
    updatedAt: 1780830000,
  })

  withOverride('1', () => {
    assert.throws(
      () => assertDataDirCompatible(makePathProvider(userDataDir), { version: '0.0.0-dev', kind: 'cli' }),
      (error) =>
        error instanceof DataDirCompatibilityError &&
        error.code === 'DATA_DIR_REQUIRES_NEWER_RUNTIME' &&
        error.currentVersion === '0.0.0-dev' &&
        error.minRuntimeVersion === '0.25.1'
    )
  })
})

test('broken JSON and invalid meta are blocked even with override', () => {
  const brokenDir = makeTempDir()
  fs.writeFileSync(path.join(brokenDir, '.chatlab-meta.json'), '{ broken', 'utf-8')

  withOverride('1', () => {
    assert.throws(
      () => assertDataDirCompatible(makePathProvider(brokenDir), { version: '0.25.0', kind: 'cli' }),
      (error) => error instanceof DataDirCompatibilityError && error.code === 'DATA_DIR_COMPATIBILITY_META_INVALID'
    )
  })

  const invalidDir = makeTempDir()
  writeMeta(invalidDir, {
    formatVersion: 1,
    minRuntimeVersion: '0.25.1-beta.0',
    dataCompatibilityVersion: 1,
    reasons: ['segment-schema'],
    updatedBy: { runtime: 'cli', module: 'chat-db-migration', version: '0.25.1' },
    updatedAt: 1780830000,
  })

  withOverride('1', () => {
    assert.throws(
      () => assertDataDirCompatible(makePathProvider(invalidDir), { version: '0.25.0', kind: 'cli' }),
      (error) => error instanceof DataDirCompatibilityError && error.code === 'DATA_DIR_COMPATIBILITY_META_INVALID'
    )
  })
})

test('raising minRuntimeVersion writes atomically and never lowers existing requirements', () => {
  const userDataDir = makeTempDir()
  const provider = makePathProvider(userDataDir)

  raiseDataDirMinRuntimeVersion(provider, {
    minRuntimeVersion: '0.26.0',
    dataCompatibilityVersion: 2,
    reason: 'future-schema',
    runtime: { version: '0.26.0', kind: 'desktop' },
    module: 'future-migration',
    now: () => 1780830000,
  })

  raiseDataDirMinRuntimeVersion(provider, {
    minRuntimeVersion: '0.25.1',
    dataCompatibilityVersion: 1,
    reason: 'segment-schema',
    runtime: { version: '0.25.1', kind: 'cli' },
    module: 'chat-db-migration',
    now: () => 1780830001,
  })

  const meta = readDataDirCompatibilityMeta(userDataDir)

  assert.equal(meta?.formatVersion, 1)
  assert.equal(meta?.minRuntimeVersion, '0.26.0')
  assert.equal(meta?.dataCompatibilityVersion, 2)
  assert.deepEqual(meta?.reasons, ['future-schema', 'segment-schema'])
  assert.deepEqual(meta?.updatedBy, { runtime: 'cli', module: 'chat-db-migration', version: '0.25.1' })
  assert.equal(meta?.updatedAt, 1780830001)
  assert.equal(fs.existsSync(path.join(userDataDir, '.chatlab-meta.json')), true)
})

test('raising minRuntimeVersion records prerelease runtime by stable core version', () => {
  const userDataDir = makeTempDir()

  const meta = raiseDataDirMinRuntimeVersion(makePathProvider(userDataDir), {
    minRuntimeVersion: '0.25.1',
    dataCompatibilityVersion: 1,
    reason: 'segment-schema',
    runtime: { version: '0.26.4-beta.1', kind: 'desktop' },
    module: 'chat-db-migration',
    now: () => 1780830000,
  })

  assert.deepEqual(meta.updatedBy, { runtime: 'desktop', module: 'chat-db-migration', version: '0.26.4' })
  assert.deepEqual(readDataDirCompatibilityMeta(userDataDir)?.updatedBy, {
    runtime: 'desktop',
    module: 'chat-db-migration',
    version: '0.26.4',
  })
})
