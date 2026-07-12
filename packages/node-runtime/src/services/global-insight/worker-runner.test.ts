import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveDefaultAnnualSummaryWorkerEntryUrl } from './worker-runner'

test('resolves TypeScript development worker beside the runner', () => {
  assert.equal(
    resolveDefaultAnnualSummaryWorkerEntryUrl(
      'file:///repo/packages/node-runtime/src/services/global-insight/worker-runner.ts'
    ).href,
    'file:///repo/packages/node-runtime/src/services/global-insight/worker-entry.ts'
  )
})

test('resolves bundled CLI worker beside the mjs bundle', () => {
  assert.equal(
    resolveDefaultAnnualSummaryWorkerEntryUrl('file:///app/cli/dist/global-insight-worker.mjs').href,
    'file:///app/cli/dist/global-insight-worker.mjs'
  )
})

test('falls back to the desktop bundled worker when no sibling entry exists', () => {
  assert.equal(
    resolveDefaultAnnualSummaryWorkerEntryUrl('file:///app/dist/main/index.js', () => false).href,
    'file:///app/dist/main/global-insight-worker.js'
  )
})
