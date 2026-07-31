import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { BetterSqliteAdapter } from '../better-sqlite3-adapter'
import { buildFtsIndex, searchByFts } from './index'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

test('buildFtsIndex indexes sparse eligible rows exactly once across keyset batches', () => {
  const raw = new Database(':memory:', { nativeBinding })
  raw.exec(`
    CREATE TABLE message (
      id INTEGER PRIMARY KEY,
      type INTEGER NOT NULL,
      content TEXT
    )
  `)
  const insert = raw.prepare('INSERT INTO message (id, type, content) VALUES (?, ?, ?)')
  const expectedRowIds = [-2, 0]
  insert.run(-2, 0, 'negative marker')
  insert.run(0, 0, 'zero marker')

  for (let index = 1; index <= 5_001; index++) {
    const id = index * 2
    insert.run(id, 0, `marker${index}`)
    expectedRowIds.push(id)
  }
  insert.run(10_003, 1, 'non text')
  insert.run(10_004, 0, '')
  insert.run(10_005, 0, null)
  insert.run(10_006, 0, '   ')

  const db = new BetterSqliteAdapter(raw)
  const result = buildFtsIndex(db)
  const actualRowIds = raw
    .prepare('SELECT rowid FROM message_fts ORDER BY rowid')
    .all()
    .map((row) => (row as { rowid: number }).rowid)

  assert.equal(result.indexed, expectedRowIds.length + 1)
  assert.deepEqual(actualRowIds, expectedRowIds)
  assert.deepEqual(searchByFts(db, ['marker1']).rowids, [2])
  assert.deepEqual(searchByFts(db, ['marker5001']).rowids, [10_002])
  raw.close()
})
