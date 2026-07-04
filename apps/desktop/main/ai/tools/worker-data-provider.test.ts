import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { adaptWorkerSqlResult } from './worker-sql-result'

describe('adaptWorkerSqlResult', () => {
  it('maps the worker limited flag to the shared truncated contract', () => {
    const result = adaptWorkerSqlResult({
      columns: ['id'],
      rows: [[1]],
      rowCount: 1,
      duration: 1,
      limited: true,
    })

    assert.equal(result.truncated, true)
  })
})
