import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { responseStatsMessagesSql } from './commands-stats'

describe('responseStatsMessagesSql', () => {
  it('orders same-second messages by id for deterministic response gaps', () => {
    const sql = responseStatsMessagesSql()

    assert.match(sql, /SELECT\s+msg\.id,/i)
    assert.match(sql, /ORDER BY msg\.ts ASC, msg\.id ASC/i)
  })
})
