import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { shouldMarkUnifiedDirMigrationDone } from './unifiedDirMigration'

describe('desktop unified directory migration', () => {
  it('marks migration done only when no directory failed', () => {
    assert.equal(shouldMarkUnifiedDirMigrationDone([]), true)
    assert.equal(shouldMarkUnifiedDirMigrationDone(['settings']), false)
  })
})
