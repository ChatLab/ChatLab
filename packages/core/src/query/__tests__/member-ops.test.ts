/**
 * Tests for shared member write operations.
 *
 * Run: npx tsx --test packages/core/src/query/__tests__/member-ops.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CHAT_DB_TABLES } from '../../schema'
import { deleteMember, ensureAliasesColumn, ensureAvatarColumn, mergeMembers, updateMemberAliases } from '../member-ops'
import { SqliteTestAdapter } from './sqlite-test-adapter'

function createDb(): SqliteTestAdapter {
  const db = new SqliteTestAdapter()
  db.exec(CHAT_DB_TABLES)
  return db
}

describe('updateMemberAliases', () => {
  it('persists aliases', () => {
    const db = createDb()
    const memberId = Number(db.prepare('INSERT INTO member (platform_id) VALUES (?)').run('alice').lastInsertRowid)

    assert.equal(updateMemberAliases(db, memberId, ['nickname1', 'nickname2']), true)
    assert.equal(
      db.prepare('SELECT aliases FROM member WHERE id = ?').get(memberId)?.aliases,
      '["nickname1","nickname2"]'
    )
    db.close()
  })
})

describe('mergeMembers', () => {
  it('rejects identical or missing members', () => {
    const db = createDb()
    db.prepare('INSERT INTO member (id, platform_id) VALUES (?, ?)').run(1, 'alice')

    assert.equal(mergeMembers(db, 1, 1), false)
    assert.equal(mergeMembers(db, 1, 2), false)
    db.close()
  })

  it('moves related data to the more active member and merges profile fields', () => {
    const db = createDb()
    db.exec(`
      INSERT INTO meta (name, platform, type, imported_at, owner_id)
      VALUES ('chat', 'test', 'private', 1, 'secondary');
      INSERT INTO member (id, platform_id, account_name, group_nickname, aliases, avatar) VALUES
        (1, 'primary', 'Alice', NULL, '["A"]', 'avatar'),
        (2, 'secondary', NULL, 'Ally', '["A","小爱"]', NULL);
      INSERT INTO message (sender_id, ts, type, content) VALUES
        (1, 1, 0, 'one'),
        (1, 2, 0, 'two'),
        (2, 3, 0, 'three');
      INSERT INTO member_name_history (member_id, name_type, name, start_ts)
      VALUES (2, 'group_nickname', 'Ally', 1);
    `)

    assert.equal(mergeMembers(db, 1, 2), true)
    assert.deepEqual(db.prepare('SELECT id FROM member ORDER BY id').all(), [{ id: 1 }])
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM message WHERE sender_id = 1').get()?.count, 3)
    assert.equal(db.prepare('SELECT member_id FROM member_name_history').get()?.member_id, 1)
    assert.equal(db.prepare('SELECT owner_id FROM meta').get()?.owner_id, 'primary')
    assert.deepEqual(db.prepare('SELECT group_nickname, aliases FROM member WHERE id = 1').get(), {
      group_nickname: 'Ally',
      aliases: '["A","小爱"]',
    })
    db.close()
  })
})

describe('deleteMember', () => {
  it('removes the member and owned records', () => {
    const db = createDb()
    db.exec(`
      INSERT INTO member (id, platform_id) VALUES (42, 'alice');
      INSERT INTO message (sender_id, ts, type) VALUES (42, 1, 0);
      INSERT INTO member_name_history (member_id, name_type, name, start_ts)
      VALUES (42, 'account_name', 'Alice', 1);
    `)

    assert.equal(deleteMember(db, 42), true)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM member WHERE id = 42').get()?.count, 0)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM message WHERE sender_id = 42').get()?.count, 0)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM member_name_history WHERE member_id = 42').get()?.count, 0)
    db.close()
  })
})

describe('member column migrations', () => {
  for (const [column, ensureColumn] of [
    ['aliases', ensureAliasesColumn],
    ['avatar', ensureAvatarColumn],
  ] as const) {
    it(`adds ${column} only when missing`, () => {
      const db = new SqliteTestAdapter()
      db.exec('CREATE TABLE member (id INTEGER PRIMARY KEY, platform_id TEXT NOT NULL)')

      assert.equal(ensureColumn(db), true)
      assert.equal(
        (db.prepare('PRAGMA table_info(member)').all() as Array<{ name: string }>).some((item) => item.name === column),
        true
      )
      assert.equal(ensureColumn(db), false)
      db.close()
    })
  }
})
