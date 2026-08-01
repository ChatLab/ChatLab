import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import { MigrationRunner } from './runner'
import type { Migration } from './types'

test('migration runner rejects when the migration version marker cannot be written', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-migration-marker-failure-'))
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }))
  fs.mkdirSync(path.join(dataDir, '.migration-version'))

  let migrated = false
  const migration: Migration = {
    version: 1,
    name: 'test-migration',
    description: 'Test migration marker failure',
    async up() {
      migrated = true
    },
  }
  const errors: unknown[][] = []
  const runner = new MigrationRunner([migration], {
    dataDir,
    aiDataDir: path.join(dataDir, 'ai'),
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: (...args: unknown[]) => errors.push(args),
    },
  })

  await assert.rejects(runner.run(), /migration-version/)
  assert.equal(migrated, true)
  assert.equal(errors.length, 1)
})
