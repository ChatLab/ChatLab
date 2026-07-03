/**
 * Tests for session/member reference resolution: ID-first matching, single-session
 * auto-select, and structured ambiguity errors with candidates (exit code 4 path).
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import type Database from 'better-sqlite3'
import type { DatabaseAdapter, PreparedStatement, RunResult } from '@openchatlab/core'
import { resolveSession, resolveMember, type SessionSource } from './resolve'
import { QueryError } from './envelope'
import { openTestSqliteDatabase } from '../../../../tests/helpers/sqlite.mts'

class Stmt implements PreparedStatement {
  readonly?: boolean
  constructor(private stmt: Database.Statement) {
    this.readonly = stmt.readonly
  }
  get(...p: unknown[]) {
    return this.stmt.get(...p) as Record<string, unknown> | undefined
  }
  all(...p: unknown[]) {
    return this.stmt.all(...p) as Record<string, unknown>[]
  }
  run(...p: unknown[]): RunResult {
    const r = this.stmt.run(...p)
    return { changes: r.changes, lastInsertRowid: r.lastInsertRowid }
  }
}

class Adapter implements DatabaseAdapter {
  constructor(private db: Database.Database) {}
  exec(sql: string) {
    this.db.exec(sql)
  }
  prepare(sql: string) {
    return new Stmt(this.db.prepare(sql))
  }
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)()
  }
  pragma(p: string) {
    return this.db.pragma(p)
  }
  close() {
    this.db.close()
  }
}

function createSessionDb(name: string, ownerId?: string): { raw: Database.Database; db: Adapter } {
  const raw = openTestSqliteDatabase()
  raw.exec(`
    CREATE TABLE meta (name TEXT, platform TEXT, type TEXT, imported_at INTEGER,
      group_id TEXT, group_avatar TEXT, owner_id TEXT);
    CREATE TABLE member (id INTEGER PRIMARY KEY, platform_id TEXT, account_name TEXT,
      group_nickname TEXT, aliases TEXT, avatar TEXT);
    CREATE TABLE message (id INTEGER PRIMARY KEY, sender_id INTEGER, ts INTEGER, type INTEGER, content TEXT);
  `)
  raw
    .prepare('INSERT INTO meta (name, platform, type, imported_at, owner_id) VALUES (?, ?, ?, ?, ?)')
    .run(name, 'wechat', 'group', 1000, ownerId ?? null)
  return { raw, db: new Adapter(raw) }
}

function sourceOf(entries: Record<string, DatabaseAdapter>): SessionSource {
  return {
    listSessionIds: () => Object.keys(entries),
    open: (id: string) => entries[id] ?? null,
  }
}

describe('resolveSession', () => {
  const opened: Database.Database[] = []
  afterEach(() => {
    for (const raw of opened.splice(0)) raw.close()
  })

  function makeSession(name: string): DatabaseAdapter {
    const { raw, db } = createSessionDb(name)
    opened.push(raw)
    return db
  }

  it('auto-selects the only session when --session is omitted', () => {
    const source = sourceOf({ 'sess-a': makeSession('家庭群') })
    const resolved = resolveSession(source)
    assert.equal(resolved.id, 'sess-a')
    assert.equal(resolved.name, '家庭群')
  })

  it('requires --session with candidates when multiple sessions exist', () => {
    const source = sourceOf({ a: makeSession('家庭群'), b: makeSession('工作群') })
    assert.throws(
      () => resolveSession(source),
      (err: unknown) =>
        err instanceof QueryError && err.code === 'SESSION_AMBIGUOUS' && (err.candidates?.length ?? 0) === 2
    )
  })

  it('resolves by id first, then by unique name', () => {
    const source = sourceOf({ a: makeSession('家庭群'), b: makeSession('工作群') })
    assert.equal(resolveSession(source, 'a').id, 'a')
    assert.equal(resolveSession(source, '工作群').id, 'b')
  })

  it('reports similar sessions as candidates for partial names', () => {
    const source = sourceOf({ a: makeSession('家庭群'), b: makeSession('大家庭群') })
    assert.throws(
      () => resolveSession(source, '家庭'),
      (err: unknown) =>
        err instanceof QueryError && err.code === 'SESSION_AMBIGUOUS' && (err.candidates?.length ?? 0) === 2
    )
  })

  it('returns SESSION_NOT_FOUND for unknown references', () => {
    const source = sourceOf({ a: makeSession('家庭群') })
    assert.throws(
      () => resolveSession(source, 'nope'),
      (err: unknown) => err instanceof QueryError && err.code === 'SESSION_NOT_FOUND'
    )
  })
})

describe('resolveMember', () => {
  let raw: Database.Database
  let db: Adapter

  beforeEach(() => {
    const created = createSessionDb('家庭群', 'owner-uid')
    raw = created.raw
    db = created.db
    const insert = raw.prepare(
      'INSERT INTO member (id, platform_id, account_name, group_nickname, aliases) VALUES (?, ?, ?, ?, ?)'
    )
    insert.run(1, 'owner-uid', '我自己', null, null)
    insert.run(2, 'u-hong', '小红', null, JSON.stringify(['红姐']))
    insert.run(3, 'u-hong2', '小红红', null, null)
  })

  afterEach(() => {
    raw.close()
  })

  it('resolves numeric ids directly', () => {
    assert.deepEqual(resolveMember(db, '2'), { id: 2, name: '小红' })
  })

  it('resolves `me` via the owner profile', () => {
    assert.equal(resolveMember(db, 'me').id, 1)
  })

  it('reports MEMBER_NOT_FOUND for `me` without owner profile', () => {
    raw.prepare('UPDATE meta SET owner_id = NULL').run()
    assert.throws(
      () => resolveMember(db, 'me'),
      (err: unknown) => err instanceof QueryError && err.code === 'MEMBER_NOT_FOUND'
    )
  })

  it('resolves exact names and aliases', () => {
    assert.equal(resolveMember(db, '小红').id, 2)
    assert.equal(resolveMember(db, '红姐').id, 2)
  })

  it('returns candidates for ambiguous partial names', () => {
    assert.throws(
      () => resolveMember(db, '红'),
      (err: unknown) =>
        err instanceof QueryError && err.code === 'MEMBER_AMBIGUOUS' && (err.candidates?.length ?? 0) === 2
    )
  })

  it('returns MEMBER_NOT_FOUND for unknown members', () => {
    assert.throws(
      () => resolveMember(db, '不存在'),
      (err: unknown) => err instanceof QueryError && err.code === 'MEMBER_NOT_FOUND'
    )
  })
})
