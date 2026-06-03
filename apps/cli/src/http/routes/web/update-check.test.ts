import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildWebUpdateCheckResult } from './update-check'

describe('CLI Web update check', () => {
  it('does not show an update notice for local development placeholder versions', () => {
    assert.deepEqual(buildWebUpdateCheckResult({ currentVersion: '0.0.0', latestVersion: '0.24.0' }), {
      hasUpdate: false,
      currentVersion: '0.0.0',
      latestVersion: '0.24.0',
    })
    assert.deepEqual(buildWebUpdateCheckResult({ currentVersion: '0.0.0-dev', latestVersion: '0.24.0' }), {
      hasUpdate: false,
      currentVersion: '0.0.0-dev',
      latestVersion: '0.24.0',
    })
  })

  it('reports stable updates for real CLI versions', () => {
    assert.deepEqual(buildWebUpdateCheckResult({ currentVersion: '0.23.0', latestVersion: '0.24.0' }), {
      hasUpdate: true,
      currentVersion: '0.23.0',
      latestVersion: '0.24.0',
    })
  })
})
