import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isNewerStableVersion, isStableVersion } from './version'

describe('stable version comparison', () => {
  it('accepts only stable semver versions', () => {
    assert.equal(isStableVersion('0.24.0'), true)
    assert.equal(isStableVersion('v0.24.0'), true)
    assert.equal(isStableVersion('0.24.0-beta.1'), false)
    assert.equal(isStableVersion('0.24.0-rc.1'), false)
    assert.equal(isStableVersion('latest'), false)
  })

  it('reports newer stable versions only when both sides are stable', () => {
    assert.equal(isNewerStableVersion('0.25.0', '0.24.0'), true)
    assert.equal(isNewerStableVersion('0.24.1', '0.24.0'), true)
    assert.equal(isNewerStableVersion('0.24.0', '0.24.0'), false)
    assert.equal(isNewerStableVersion('0.23.9', '0.24.0'), false)
    assert.equal(isNewerStableVersion('0.25.0-beta.1', '0.24.0'), false)
    assert.equal(isNewerStableVersion('0.25.0', '0.25.0-beta.1'), false)
  })
})
