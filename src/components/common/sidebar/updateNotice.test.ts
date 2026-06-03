import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { UPDATE_CHECK_INTERVAL_MS, buildUpdateNoticeState, shouldUseCachedUpdateNotice } from './updateNotice'

describe('update notice state', () => {
  it('uses server-computed CLI status instead of recomputing from the bundled UI version', () => {
    const state = buildUpdateNoticeState({
      latestVersion: '0.24.0',
      currentVersion: '0.23.0',
      serverHasUpdate: false,
    })

    assert.deepEqual(state, {
      latestVersion: '0.24.0',
      currentVersion: '0.23.0',
      hasUpdate: false,
    })
  })

  it('does not reuse positive CLI Web cache entries', () => {
    const now = 10_000
    const freshPositiveCache = {
      lastCheckTime: now - UPDATE_CHECK_INTERVAL_MS + 1,
      latestVersion: '0.24.0',
      hasUpdate: true,
      currentVersion: '0.23.0',
    }
    const freshNegativeCache = {
      ...freshPositiveCache,
      hasUpdate: false,
    }

    assert.equal(
      shouldUseCachedUpdateNotice(freshPositiveCache, { isElectron: false, currentVersion: '0.23.0', now }),
      false
    )
    assert.equal(
      shouldUseCachedUpdateNotice(freshNegativeCache, { isElectron: false, currentVersion: '0.23.0', now }),
      true
    )
    assert.equal(
      shouldUseCachedUpdateNotice(freshPositiveCache, { isElectron: true, currentVersion: '0.23.0', now }),
      true
    )
  })

  it('does not reuse desktop cache entries created by another current version', () => {
    const now = 10_000
    const freshPositiveCache = {
      lastCheckTime: now - UPDATE_CHECK_INTERVAL_MS + 1,
      latestVersion: '0.24.0',
      hasUpdate: true,
      currentVersion: '0.23.0',
    }

    assert.equal(
      shouldUseCachedUpdateNotice(freshPositiveCache, { isElectron: true, currentVersion: '0.24.0', now }),
      false
    )
  })
})
