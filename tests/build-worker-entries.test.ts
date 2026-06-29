/**
 * Regression tests for worker bundle entry configuration.
 *
 * Run: pnpm test -- tests/build-worker-entries.test.ts
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function readProjectFile(path: string): string {
  return readFileSync(path, 'utf-8')
}

test('CLI bundle emits the people relationships worker entry expected by the runtime resolver', () => {
  const config = readProjectFile('apps/cli/tsup.config.ts')

  assert.match(config, /['"]people-relationships-worker['"]\s*:/)
  assert.match(config, /packages\/node-runtime\/src\/services\/people\/relationships\/worker-entry\.ts/)
})

test('Desktop bundle emits the people relationships worker entry expected by the runtime resolver', () => {
  const config = readProjectFile('apps/desktop/electron.vite.config.ts')

  assert.match(config, /['"]people-relationships-worker['"]\s*:/)
  assert.match(config, /packages\/node-runtime\/src\/services\/people\/relationships\/worker-entry\.ts/)
})
