import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { shouldShowSyncError } from './apiSettingsSyncStatus'

describe('shouldShowSyncError', () => {
  it('shows the failure reason for a first pull that failed with a zero cursor', () => {
    assert.equal(
      shouldShowSyncError({ lastStatus: 'error', lastError: 'net::ERR_CONNECTION_REFUSED' }, false),
      true
    )
  })

  it('hides the error while a pull is in progress', () => {
    assert.equal(
      shouldShowSyncError({ lastStatus: 'error', lastError: 'net::ERR_CONNECTION_REFUSED' }, true),
      false
    )
  })

  it('hides the error when the last pull succeeded', () => {
    assert.equal(shouldShowSyncError({ lastStatus: 'success', lastError: '' }, false), false)
  })

  it('hides an empty error message', () => {
    assert.equal(shouldShowSyncError({ lastStatus: 'error', lastError: '' }, false), false)
  })
})
