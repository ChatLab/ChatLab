import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { shouldMarkUnifiedDirMigrationDone } from './paths'

describe('desktop path migration', () => {
  it('marks unified directory migration done only when no directory failed', () => {
    assert.equal(shouldMarkUnifiedDirMigrationDone([]), true)
    assert.equal(shouldMarkUnifiedDirMigrationDone(['settings']), false)
  })
})
