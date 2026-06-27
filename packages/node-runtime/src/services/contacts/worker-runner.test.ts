/**
 * Run: pnpm test -- packages/node-runtime/src/services/contacts/worker-runner.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveDefaultContactsWorkerEntryUrl } from './worker-runner'

test('contacts worker runner resolves source worker entry in TypeScript dev mode', () => {
  const entry = resolveDefaultContactsWorkerEntryUrl(
    'file:///repo/packages/node-runtime/src/services/contacts/worker-runner.ts'
  )

  assert.equal(entry.href, 'file:///repo/packages/node-runtime/src/services/contacts/worker-entry.ts')
})

test('contacts worker runner resolves bundled CLI worker entry next to mjs bundle', () => {
  const entry = resolveDefaultContactsWorkerEntryUrl('file:///app/cli/dist/index.mjs')

  assert.equal(entry.href, 'file:///app/cli/dist/contacts-worker.mjs')
})

test('contacts worker runner resolves bundled Desktop worker entry when sibling source entry is absent', () => {
  const entry = resolveDefaultContactsWorkerEntryUrl('file:///app/dist/main/index.js', () => false)

  assert.equal(entry.href, 'file:///app/dist/main/contacts-worker.js')
})

test('contacts worker runner keeps node-runtime sibling worker entry when it exists', () => {
  const entry = resolveDefaultContactsWorkerEntryUrl(
    'file:///repo/packages/node-runtime/dist/services/contacts/worker-runner.js',
    (url) => url.href.endsWith('/worker-entry.js')
  )

  assert.equal(entry.href, 'file:///repo/packages/node-runtime/dist/services/contacts/worker-entry.js')
})
