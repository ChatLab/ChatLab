/**
 * Run: pnpm test -- packages/core/src/query/__tests__/contact-queries-aliases.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { CHAT_DB_TABLES } from '../../schema'
import { getNonSystemMembersForContacts } from '../contact-queries'
import { SqliteTestAdapter } from './sqlite-test-adapter'

test('contact member refs include parsed saved aliases', () => {
  const db = new SqliteTestAdapter()
  db.exec(CHAT_DB_TABLES)
  db.prepare(
    `INSERT INTO member (platform_id, account_name, aliases)
     VALUES (?, ?, ?)`
  ).run('alice-pid', 'Alice', '["Ally","小爱"]')

  const members = getNonSystemMembersForContacts(db)

  assert.deepEqual(members[0]?.aliases, ['Ally', '小爱'])
  db.close()
})
