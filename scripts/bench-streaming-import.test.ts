import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { CHAT_DB_TABLES } from '@openchatlab/core'
import { BetterSqliteAdapter } from '../packages/node-runtime/src/better-sqlite3-adapter'
import { buildFtsIndex } from '../packages/node-runtime/src/fts'
import { createChatLabTempDir } from './chatlab-temp.mjs'
import { createBenchmarkParserMonitor, inspectDatabase, resolveBenchmarkParser } from './bench-streaming-import.mts'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

test('benchmark requires and records the Rust Native WeFlow parser', () => {
  assert.deepEqual(resolveBenchmarkParser({ available: true, disabled: false }, true), {
    formatId: 'weflow',
    implementation: 'rust-native',
    nativeModuleAvailable: true,
  })
  assert.throws(
    () => resolveBenchmarkParser({ available: false, disabled: true }, false),
    /CHATLAB_DISABLE_NATIVE_PERF=1/
  )
  assert.throws(
    () => resolveBenchmarkParser({ available: true, disabled: false }, false),
    /does not provide the WeFlow kernel/
  )
})

test('benchmark rejects imports that do not complete with the Rust Native WeFlow parser', () => {
  const missingNative = createBenchmarkParserMonitor()
  assert.throws(() => missingNative.assertRustNativeCompleted(0), /did not start the Rust Native WeFlow parser/)

  const native = createBenchmarkParserMonitor()
  native.logger.info('[NativeParser] Parsing WeFlow export with Rust kernel, size: 1.00 MB')
  assert.doesNotThrow(() => native.assertRustNativeCompleted(1))

  native.logger.info('[NativeParser] Rust parse failed, falling back to TS parser: invalid fixture')
  assert.throws(() => native.assertRustNativeCompleted(1), /fell back to the TypeScript WeFlow parser/)
})

function createFixtureDatabase(dbPath: string): void {
  const raw = new Database(dbPath, { nativeBinding })
  raw.exec(CHAT_DB_TABLES)
  raw
    .prepare(
      `INSERT INTO meta
         (name, platform, type, imported_at, group_id, group_avatar, owner_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run('Signature Test', 'WeChat', 'group', 1_704_164_645, 'group-1', null, 'member-1')
  const insertMember = raw.prepare(
    `INSERT INTO member
       (platform_id, account_name, group_nickname, aliases, avatar, roles)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
  insertMember.run('member-1', 'Alice', 'Alice', '[]', null, '[]')
  insertMember.run('member-2', 'Bob', 'Bob', '[]', null, '[]')
  const insertMessage = raw.prepare(
    `INSERT INTO message
       (sender_id, sender_account_name, sender_group_nickname, ts, type, content)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
  insertMessage.run(1, 'Alice', 'Alice', 1_704_164_645, 0, 'alpha')
  insertMessage.run(2, 'Bob', 'Bob', 1_704_164_648, 0, 'bravo')
  buildFtsIndex(new BetterSqliteAdapter(raw))
  raw.close()
}

test('canonical database signature changes for equal-length content and sender permutations', () => {
  const root = createChatLabTempDir('tests', 'bench-signature-')
  const dbPath = path.join(root, 'session.db')
  try {
    createFixtureDatabase(dbPath)
    const baseline = inspectDatabase(dbPath)
    assert.equal(baseline.messages, 2)
    assert.equal(baseline.members, 2)

    const raw = new Database(dbPath, { nativeBinding })
    raw.prepare('UPDATE message SET content = ? WHERE id = 1').run('omega')
    raw.close()
    const changedContent = inspectDatabase(dbPath)
    assert.notEqual(changedContent.signature, baseline.signature)

    const senderDb = new Database(dbPath, { nativeBinding })
    senderDb.prepare('UPDATE message SET content = ? WHERE id = 1').run('alpha')
    senderDb.exec(
      `UPDATE message
       SET sender_id = CASE id
         WHEN 1 THEN 2
         WHEN 2 THEN 1
       END`
    )
    senderDb.close()
    const changedSenders = inspectDatabase(dbPath)
    assert.notEqual(changedSenders.signature, baseline.signature)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
