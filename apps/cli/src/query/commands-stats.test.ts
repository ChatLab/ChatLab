import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { executeParameterizedSql } from '@openchatlab/core'
import { openBetterSqliteDatabase } from '@openchatlab/node-runtime'

import { responseStatsMessagesSql } from './commands-stats'

describe('responseStatsMessagesSql', () => {
  it('orders same-second messages by id for deterministic response gaps', () => {
    const db = openBetterSqliteDatabase(':memory:')
    try {
      db.exec(`
        CREATE TABLE member (
          id INTEGER PRIMARY KEY,
          account_name TEXT,
          group_nickname TEXT
        );
        CREATE TABLE message (
          id INTEGER PRIMARY KEY,
          sender_id INTEGER NOT NULL,
          ts INTEGER NOT NULL,
          type INTEGER NOT NULL
        );
        INSERT INTO member (id, account_name) VALUES (1, 'Alice'), (2, 'Bob');
        INSERT INTO message (id, sender_id, ts, type) VALUES
          (30, 1, 100, 0),
          (10, 2, 100, 0),
          (20, 1, 100, 0),
          (40, 2, 110, 0);
      `)

      const rows = executeParameterizedSql<{ id: number; sender_id: number }>(db, responseStatsMessagesSql(), {
        startTs: 0,
      })

      assert.deepEqual(
        rows.map(({ id, sender_id }) => [id, sender_id]),
        [
          [10, 2],
          [20, 1],
          [30, 1],
          [40, 2],
        ]
      )
    } finally {
      db.close()
    }
  })
})
