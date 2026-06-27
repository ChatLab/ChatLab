/**
 * Run: pnpm test -- packages/core/src/query/__tests__/contact-queries-aliases.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import type { DatabaseAdapter, PreparedStatement, RunResult } from '../../interfaces'
import { getNonSystemMembersForContacts } from '../contact-queries'

class StaticStatement implements PreparedStatement {
  readonly = true

  constructor(private readonly rows: Array<Record<string, unknown>>) {}

  get(): Record<string, unknown> | undefined {
    return this.rows[0]
  }

  all(): Array<Record<string, unknown>> {
    return this.rows
  }

  run(): RunResult {
    return { changes: 0, lastInsertRowid: 0 }
  }
}

class StaticDb implements DatabaseAdapter {
  closed = false

  prepare(sql: string): PreparedStatement {
    assert.match(sql, /SELECT/)
    return new StaticStatement([
      {
        id: 1,
        platformId: 'alice-pid',
        name: 'Alice',
        aliases: '["Ally","小爱"]',
        avatar: null,
      },
    ])
  }

  exec(): void {
    throw new Error('exec is not used in this test')
  }

  transaction<T>(fn: () => T): T {
    return fn()
  }

  pragma(): unknown {
    return [
      { name: 'id' },
      { name: 'platform_id' },
      { name: 'account_name' },
      { name: 'group_nickname' },
      { name: 'aliases' },
      { name: 'avatar' },
    ]
  }

  close(): void {
    this.closed = true
  }
}

test('contact member refs include parsed saved aliases', () => {
  const members = getNonSystemMembersForContacts(new StaticDb())

  assert.deepEqual(members[0]?.aliases, ['Ally', '小爱'])
})
