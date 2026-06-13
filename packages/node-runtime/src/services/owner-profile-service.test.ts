/**
 * Integration tests for the owner profile service, against real SQLite
 * session databases and a real preferences.json file.
 *
 * Run: pnpm test -- packages/node-runtime/src/services/owner-profile-service.test.ts
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { CHAT_DB_SCHEMA, getSessionMeta } from '@openchatlab/core'
import type { DatabaseAdapter } from '@openchatlab/core'
import { openBetterSqliteDatabase } from '../better-sqlite3-adapter'
import { PreferencesManager } from '../preferences'
import type { SessionRuntimeAdapter } from './adapters'
import {
  tryApplyOwnerProfile,
  setOwnerAndApplyProfile,
  dismissOwnerPrompt,
  clearSessionOwner,
} from './owner-profile-service'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

function makeTempDir(): string {
  const baseDir = fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir()
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-owner-profile-'))
}

interface SeedMember {
  platformId: string
  accountName?: string
  groupNickname?: string
  aliases?: string[]
}

interface SeedSession {
  id: string
  platform: string
  type?: 'group' | 'private'
  ownerId?: string | null
  members: SeedMember[]
}

class TestEnv {
  readonly dir: string
  readonly preferences: PreferencesManager
  readonly adapter: SessionRuntimeAdapter
  private dbPaths = new Map<string, string>()
  private openDbs: DatabaseAdapter[] = []

  constructor() {
    this.dir = makeTempDir()
    this.preferences = new PreferencesManager(this.dir)
    const open = (sessionId: string, readonly: boolean): DatabaseAdapter | null => {
      const dbPath = this.dbPaths.get(sessionId)
      if (!dbPath) return null
      const db = openBetterSqliteDatabase(dbPath, { readonly, nativeBinding })
      this.openDbs.push(db)
      return db
    }
    this.adapter = {
      listSessionIds: () => [...this.dbPaths.keys()],
      openReadonly: (id) => open(id, true),
      openWritable: (id) => open(id, false),
      closeSession: () => {},
      getDbPath: (id) => this.dbPaths.get(id) ?? '',
      deleteSessionFile: () => false,
      ensureReadonly: (id) => {
        const db = open(id, true)
        if (!db) throw Object.assign(new Error(`Session not found: ${id}`), { statusCode: 404 })
        return db
      },
      ensureWritable: (id) => {
        const db = open(id, false)
        if (!db) throw Object.assign(new Error(`Session not found: ${id}`), { statusCode: 404 })
        return db
      },
    }
  }

  seed(session: SeedSession): void {
    const dbPath = path.join(this.dir, `${session.id}.db`)
    const db = openBetterSqliteDatabase(dbPath, { nativeBinding })
    db.exec(CHAT_DB_SCHEMA)
    db.prepare(`INSERT INTO meta (name, platform, type, imported_at, owner_id) VALUES (?, ?, ?, ?, ?)`).run(
      session.id,
      session.platform,
      session.type ?? 'group',
      1780000000,
      session.ownerId ?? null
    )
    for (const member of session.members) {
      db.prepare(`INSERT INTO member (platform_id, account_name, group_nickname, aliases) VALUES (?, ?, ?, ?)`).run(
        member.platformId,
        member.accountName ?? null,
        member.groupNickname ?? null,
        JSON.stringify(member.aliases ?? [])
      )
    }
    db.close()
    this.dbPaths.set(session.id, dbPath)
  }

  ownerOf(sessionId: string): string | null {
    const db = this.adapter.ensureReadonly(sessionId)
    return getSessionMeta(db)?.ownerId ?? null
  }

  cleanup(): void {
    for (const db of this.openDbs) {
      try {
        db.close()
      } catch {
        // already closed
      }
    }
    fs.rmSync(this.dir, { recursive: true, force: true })
  }
}

test('setOwnerAndApplyProfile writes owner, saves platform profile and merges names', (t) => {
  const env = new TestEnv()
  t.after(() => env.cleanup())

  env.seed({
    id: 's1',
    platform: 'whatsapp',
    members: [
      { platformId: 'Alice', accountName: 'Alice', groupNickname: 'Ali', aliases: ['Allie'] },
      { platformId: 'Bob' },
    ],
  })

  const result = setOwnerAndApplyProfile(env.adapter, env.preferences, 's1', 'Alice')
  assert.equal(result.ownerId, 'Alice')
  assert.equal(result.platform, 'whatsapp')
  assert.deepEqual(result.updatedSessionIds, [])
  assert.deepEqual(result.updatedSessionOwnerIds, {})
  assert.equal(env.ownerOf('s1'), 'Alice')

  env.preferences.invalidateCache()
  const profile = env.preferences.load().ownerProfilesByPlatform['whatsapp']
  assert.ok(profile)
  assert.equal(profile.platformId, 'Alice')
  assert.equal(profile.matchMode, 'name')
  assert.deepEqual(profile.confirmedNames, ['Alice', 'Ali', 'Allie'])
})

test('setOwnerAndApplyProfile batch-applies to unowned same-platform sessions only', (t) => {
  const env = new TestEnv()
  t.after(() => env.cleanup())

  env.seed({ id: 'current', platform: 'whatsapp', members: [{ platformId: 'Alice' }, { platformId: 'Bob' }] })
  // Name fallback match (different platformId, same normalized name)
  env.seed({ id: 'name-match', platform: 'whatsapp', members: [{ platformId: 'alice' }, { platformId: 'Carol' }] })
  // Already owned: never overridden
  env.seed({ id: 'owned', platform: 'whatsapp', ownerId: 'Bob', members: [{ platformId: 'Alice' }] })
  // Different platform: untouched
  env.seed({ id: 'other-platform', platform: 'telegram', members: [{ platformId: 'Alice' }] })
  // Ambiguous: two members normalize to the same confirmed name
  env.seed({
    id: 'ambiguous',
    platform: 'whatsapp',
    members: [{ platformId: 'alice' }, { platformId: 'u2', accountName: 'ALICE' }],
  })
  // No match
  env.seed({ id: 'no-match', platform: 'whatsapp', members: [{ platformId: 'Dave' }] })

  const result = setOwnerAndApplyProfile(env.adapter, env.preferences, 'current', 'Alice')
  assert.deepEqual(result.updatedSessionIds, ['name-match'])
  // name-match session has platformId 'alice' (lowercase) — must differ from source ownerId 'Alice'
  assert.deepEqual(result.updatedSessionOwnerIds, { 'name-match': 'alice' })
  assert.equal(env.ownerOf('name-match'), 'alice')
  assert.equal(env.ownerOf('owned'), 'Bob')
  assert.equal(env.ownerOf('other-platform'), null)
  assert.equal(env.ownerOf('ambiguous'), null)
  assert.equal(env.ownerOf('no-match'), null)
})

test('re-selecting a different member replaces the profile instead of merging names', (t) => {
  const env = new TestEnv()
  t.after(() => env.cleanup())

  env.seed({ id: 's1', platform: 'whatsapp', members: [{ platformId: 'Alice' }, { platformId: 'Bob' }] })

  setOwnerAndApplyProfile(env.adapter, env.preferences, 's1', 'Alice')
  setOwnerAndApplyProfile(env.adapter, env.preferences, 's1', 'Bob')

  env.preferences.invalidateCache()
  const profile = env.preferences.load().ownerProfilesByPlatform['whatsapp']
  assert.equal(profile.platformId, 'Bob')
  assert.deepEqual(profile.confirmedNames, ['Bob'])
})

test('setOwnerAndApplyProfile rejects a platformId that is not a session member', (t) => {
  const env = new TestEnv()
  t.after(() => env.cleanup())

  env.seed({ id: 's1', platform: 'whatsapp', members: [{ platformId: 'Alice' }] })
  assert.throws(() => setOwnerAndApplyProfile(env.adapter, env.preferences, 's1', 'Nobody'), /Member not found/)
})

test('tryApplyOwnerProfile applies stored profile and reports reasons', (t) => {
  const env = new TestEnv()
  t.after(() => env.cleanup())

  env.seed({ id: 'source', platform: 'whatsapp', members: [{ platformId: 'Alice' }] })
  env.seed({ id: 'unowned', platform: 'whatsapp', members: [{ platformId: 'Alice' }, { platformId: 'Bob' }] })
  env.seed({ id: 'no-profile', platform: 'telegram', members: [{ platformId: 'Alice' }] })

  // No profile saved yet
  assert.deepEqual(tryApplyOwnerProfile(env.adapter, env.preferences, 'unowned'), {
    applied: false,
    reason: 'no_profile',
    dismissed: false,
  })

  setOwnerAndApplyProfile(env.adapter, env.preferences, 'source', 'Alice')
  // 'unowned' was already auto-filled by batch apply
  assert.equal(env.ownerOf('unowned'), 'Alice')
  assert.deepEqual(tryApplyOwnerProfile(env.adapter, env.preferences, 'unowned'), {
    applied: false,
    ownerId: 'Alice',
    reason: 'already_set',
    dismissed: false,
  })

  // New session imported later: profile applies on demand
  env.seed({ id: 'later', platform: 'whatsapp', members: [{ platformId: 'Alice' }, { platformId: 'Carol' }] })
  const applied = tryApplyOwnerProfile(env.adapter, env.preferences, 'later')
  assert.deepEqual(applied, { applied: true, ownerId: 'Alice', dismissed: false })
  assert.equal(env.ownerOf('later'), 'Alice')

  assert.deepEqual(tryApplyOwnerProfile(env.adapter, env.preferences, 'no-profile'), {
    applied: false,
    reason: 'no_profile',
    dismissed: false,
  })
  assert.equal(tryApplyOwnerProfile(env.adapter, env.preferences, 'missing').reason, 'missing_session')
})

test('dismissOwnerPrompt persists and is cleared by manual owner selection', (t) => {
  const env = new TestEnv()
  t.after(() => env.cleanup())

  env.seed({ id: 's1', platform: 'whatsapp', members: [{ platformId: 'Alice' }] })

  dismissOwnerPrompt(env.preferences, 's1')
  dismissOwnerPrompt(env.preferences, 's1')
  env.preferences.invalidateCache()
  assert.deepEqual(env.preferences.load().ownerPromptDismissedSessionIds, ['s1'])
  assert.equal(tryApplyOwnerProfile(env.adapter, env.preferences, 's1').dismissed, true)

  setOwnerAndApplyProfile(env.adapter, env.preferences, 's1', 'Alice')
  env.preferences.invalidateCache()
  assert.deepEqual(env.preferences.load().ownerPromptDismissedSessionIds, [])
})

test('batch apply removes auto-filled sessions from the dismissed list', (t) => {
  const env = new TestEnv()
  t.after(() => env.cleanup())

  env.seed({ id: 'current', platform: 'whatsapp', members: [{ platformId: 'Alice' }] })
  env.seed({ id: 'other', platform: 'whatsapp', members: [{ platformId: 'Alice' }, { platformId: 'Bob' }] })

  dismissOwnerPrompt(env.preferences, 'other')
  const result = setOwnerAndApplyProfile(env.adapter, env.preferences, 'current', 'Alice')
  assert.deepEqual(result.updatedSessionIds, ['other'])

  env.preferences.invalidateCache()
  assert.deepEqual(env.preferences.load().ownerPromptDismissedSessionIds, [])
})

test('clearSessionOwner clears the session owner but keeps the platform profile', (t) => {
  const env = new TestEnv()
  t.after(() => env.cleanup())

  env.seed({ id: 's1', platform: 'whatsapp', members: [{ platformId: 'Alice' }] })
  setOwnerAndApplyProfile(env.adapter, env.preferences, 's1', 'Alice')
  assert.equal(env.ownerOf('s1'), 'Alice')

  clearSessionOwner(env.adapter, 's1')
  assert.equal(env.ownerOf('s1'), null)

  env.preferences.invalidateCache()
  assert.ok(env.preferences.load().ownerProfilesByPlatform['whatsapp'])
})

test('exact platformId match works on platforms without name fallback', (t) => {
  const env = new TestEnv()
  t.after(() => env.cleanup())

  env.seed({ id: 'source', platform: 'weixin', members: [{ platformId: 'wx_me', accountName: 'Me' }] })
  env.seed({
    id: 'other',
    platform: 'weixin',
    members: [
      { platformId: 'wx_me', accountName: 'Renamed' },
      { platformId: 'wx_other', accountName: 'Me' },
    ],
  })

  const result = setOwnerAndApplyProfile(env.adapter, env.preferences, 'source', 'wx_me')
  assert.equal(result.platform, 'weixin')
  assert.deepEqual(result.updatedSessionIds, ['other'])
  assert.deepEqual(result.updatedSessionOwnerIds, { other: 'wx_me' })
  assert.equal(env.ownerOf('other'), 'wx_me')

  env.preferences.invalidateCache()
  assert.equal(env.preferences.load().ownerProfilesByPlatform['weixin'].matchMode, 'platform_id')

  // Name-only coincidence must NOT match on weixin
  env.seed({ id: 'name-only', platform: 'weixin', members: [{ platformId: 'wx_x', accountName: 'Me' }] })
  assert.equal(tryApplyOwnerProfile(env.adapter, env.preferences, 'name-only').reason, 'no_match')
})
