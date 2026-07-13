import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DatabaseManager } from '../database-manager'
import { raiseDataDirMinRuntimeVersion, readDataDirCompatibilityMeta, type RuntimeIdentity } from '../data-dir-compat'
import { withDataDirImportLock } from '../import/import-lock'
import type { PushImportPayload } from './push-importer'
import { executeAnalyzePushImport, pushImport } from './push-importer'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

function makeTempDir(): string {
  const baseDir = fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir()
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-push-import-'))
}

function createDatabaseManager(rootDir: string, runtime?: RuntimeIdentity): DatabaseManager {
  return new DatabaseManager(
    {
      getSystemDir: () => rootDir,
      getUserDataDir: () => rootDir,
      getDatabaseDir: () => path.join(rootDir, 'databases'),
      getVectorDir: () => path.join(rootDir, 'vector'),
      getAiDataDir: () => path.join(rootDir, 'ai'),
      getSettingsDir: () => path.join(rootDir, 'settings'),
      getCacheDir: () => path.join(rootDir, 'cache'),
      getTempDir: () => path.join(rootDir, 'temp'),
      getLogsDir: () => path.join(rootDir, 'logs'),
      getDownloadsDir: () => rootDir,
    },
    runtime ? { nativeBinding, runtime } : { nativeBinding, allowMissingRuntimeForTests: true }
  )
}

function analyzePushImport(manager: DatabaseManager, sessionId: string, payload: PushImportPayload) {
  return executeAnalyzePushImport(
    {
      getDbPath: (id) => manager.getDbPath(id),
      openDatabase: (id, options) => manager.openRawSessionDatabase(id, options),
    },
    sessionId,
    payload
  )
}

test('analyzes a new push payload with the same optional-account and member semantics as the writer', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const manager = createDatabaseManager(tempDir)
  const payload: PushImportPayload = {
    chatlab: { version: '0.0.2', exportedAt: 1780330900 },
    meta: { name: 'Push Import Analysis', platform: 'wechat', type: 'group' },
    members: [{ platformId: 'wxid_alice', accountName: 'Alice' }],
    messages: [{ sender: 'wxid_bob', timestamp: 1780330832, type: 0, content: 'hello' }],
  }

  const analysis = await analyzePushImport(manager, 'push-analysis', payload)

  assert.deepEqual(analysis, {
    ok: true,
    result: {
      sessionId: 'push-analysis',
      created: true,
      totalInFile: 1,
      newMessageCount: 1,
      duplicateCount: 0,
      newMemberCount: 2,
    },
  })
  assert.equal(fs.existsSync(manager.getDbPath('push-analysis')), false)

  const outcome = await pushImport(manager, 'push-analysis', payload)
  assert.equal(outcome.ok, true)
  if (!outcome.ok || !analysis.ok || !analysis.result.created) return
  assert.equal(outcome.result.batch.writtenCount, analysis.result.newMessageCount)
  assert.equal(outcome.result.batch.duplicateCount, analysis.result.duplicateCount)
  assert.equal(outcome.result.updates.membersAdded, analysis.result.newMemberCount)
})

test('analyzes incremental push deduplication without writing', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const manager = createDatabaseManager(tempDir)
  const initialOutcome = await pushImport(manager, 'incremental-analysis', {
    chatlab: { version: '0.0.2', exportedAt: 1780330900 },
    meta: { name: 'Incremental Analysis', platform: 'wechat', type: 'group' },
    members: [{ platformId: 'wxid_alice', accountName: 'Alice' }],
    messages: [
      {
        platformMessageId: 'msg-1',
        sender: 'wxid_alice',
        timestamp: 1780330832,
        type: 0,
        content: 'hello',
      },
    ],
  })
  assert.equal(initialOutcome.ok, true)

  const payload: PushImportPayload = {
    members: [{ platformId: 'wxid_charlie', accountName: 'Charlie' }],
    messages: [
      {
        platformMessageId: 'msg-1',
        sender: 'wxid_alice',
        timestamp: 1780330832,
        type: 0,
        content: 'hello',
      },
      { sender: 'wxid_bob', timestamp: 1780330833, type: 0, content: 'new message' },
    ],
  }

  const analysis = await analyzePushImport(manager, 'incremental-analysis', payload)
  assert.deepEqual(analysis, {
    ok: true,
    result: {
      sessionId: 'incremental-analysis',
      created: false,
      totalInFile: 2,
      newMessageCount: 1,
      duplicateCount: 1,
    },
  })

  const beforeWrite = manager.openRawSessionDatabase('incremental-analysis', { readonly: true })
  try {
    assert.equal((beforeWrite.prepare('SELECT COUNT(*) as count FROM message').get() as { count: number }).count, 1)
    assert.equal((beforeWrite.prepare('SELECT COUNT(*) as count FROM member').get() as { count: number }).count, 1)
  } finally {
    beforeWrite.close()
  }

  const outcome = await pushImport(manager, 'incremental-analysis', payload)
  assert.equal(outcome.ok, true)
  if (!outcome.ok || !analysis.ok) return
  assert.equal(outcome.result.batch.writtenCount, analysis.result.newMessageCount)
  assert.equal(outcome.result.batch.duplicateCount, analysis.result.duplicateCount)
})

test('rejects push imports while any writer holds the data-directory import lock', async (t) => {
  const root = makeTempDir()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const manager = createDatabaseManager(root)
  const payload: PushImportPayload = {
    chatlab: { version: '0.0.2', exportedAt: 1780330900 },
    meta: { name: 'Concurrent Session', platform: 'wechat', type: 'private' },
    members: [{ platformId: 'wxid_alice', accountName: 'Alice' }],
    messages: [{ sender: 'wxid_alice', timestamp: 1780330832, type: 0, content: 'hello' }],
  }

  const outcome = await withDataDirImportLock(root, () => pushImport(manager, 'different-session', payload))

  assert.deepEqual(outcome, {
    ok: false,
    reason: 'import_in_progress',
    message: 'Another import is already in progress',
  })
  assert.equal(fs.existsSync(manager.getDbPath('different-session')), false)
})

test('rejects unsafe session IDs before resolving or opening a database path', async (t) => {
  const root = makeTempDir()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const manager = createDatabaseManager(root)

  const outcome = await pushImport(manager, '../escape', {
    chatlab: { version: '0.0.2', exportedAt: 1780330900 },
    meta: { name: 'Unsafe Session', platform: 'wechat', type: 'private' },
    messages: [{ sender: 'wxid_alice', timestamp: 1780330832, type: 0, content: 'hello' }],
  })

  assert.deepEqual(outcome, {
    ok: false,
    reason: 'invalid_payload',
    message: 'sessionId contains invalid characters',
  })
  assert.equal(fs.existsSync(path.join(root, 'escape.db')), false)
})

test('raises the data directory compatibility gate after a successful push import', async (t) => {
  const root = makeTempDir()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const manager = createDatabaseManager(root, { version: '0.25.1', kind: 'cli' })

  const outcome = await pushImport(manager, 'compatibility-gate', {
    chatlab: { version: '0.0.2', exportedAt: 1780330900 },
    meta: { name: 'Compatibility Gate', platform: 'wechat', type: 'private' },
    messages: [{ sender: 'wxid_alice', timestamp: 1780330832, type: 0, content: 'hello' }],
  })

  assert.equal(outcome.ok, true)
  const meta = readDataDirCompatibilityMeta(root)
  assert.equal(meta?.minRuntimeVersion, '0.25.1')
  assert.equal(meta?.dataCompatibilityVersion, 1)
  assert.deepEqual(meta?.reasons, ['segment-schema'])
})

test('checks data directory compatibility before creating a push-import database', async (t) => {
  const root = makeTempDir()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  raiseDataDirMinRuntimeVersion(
    {
      getSystemDir: () => root,
      getUserDataDir: () => root,
      getDatabaseDir: () => path.join(root, 'databases'),
      getVectorDir: () => path.join(root, 'vector'),
      getAiDataDir: () => path.join(root, 'ai'),
      getSettingsDir: () => path.join(root, 'settings'),
      getCacheDir: () => path.join(root, 'cache'),
      getTempDir: () => path.join(root, 'temp'),
      getLogsDir: () => path.join(root, 'logs'),
      getDownloadsDir: () => root,
    },
    {
      minRuntimeVersion: '0.26.0',
      dataCompatibilityVersion: 2,
      reason: 'future-schema',
      runtime: { version: '0.26.0', kind: 'desktop' },
      module: 'future-migration',
    }
  )
  const manager = createDatabaseManager(root, { version: '0.25.1', kind: 'cli' })

  await assert.rejects(
    () =>
      pushImport(manager, 'incompatible-data-dir', {
        chatlab: { version: '0.0.2', exportedAt: 1780330900 },
        meta: { name: 'Incompatible', platform: 'wechat', type: 'private' },
        messages: [{ sender: 'wxid_alice', timestamp: 1780330832, type: 0, content: 'hello' }],
      }),
    /requires runtime version 0\.26\.0 or newer/
  )
  assert.equal(fs.existsSync(path.join(root, 'databases', 'incompatible-data-dir.db')), false)
})

test('deduplicates initial push batch when a platform-id message is repeated without platform id', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const manager = createDatabaseManager(tempDir)
  const payload: PushImportPayload = {
    chatlab: { version: '0.0.2', exportedAt: 1780330900 },
    meta: { name: 'Push Import Session', platform: 'wechat', type: 'private' },
    members: [{ platformId: 'wxid_alice', accountName: 'Alice' }],
    messages: [
      {
        platformMessageId: 'msg-1',
        sender: 'wxid_alice',
        accountName: 'Alice',
        timestamp: 1780330832,
        type: 0,
        content: 'same content',
      },
      {
        sender: 'wxid_alice',
        accountName: 'Alice',
        timestamp: 1780330832,
        type: 0,
        content: 'same content',
      },
    ],
  }

  const outcome = await pushImport(manager, 'initial-dedup', payload)
  assert.equal(outcome.ok, true)
  if (!outcome.ok) return
  assert.deepEqual(outcome.result.batch, {
    receivedCount: 2,
    writtenCount: 1,
    duplicateCount: 1,
  })

  const db = manager.openRawSessionDatabase('initial-dedup', { readonly: true })
  try {
    const row = db.prepare('SELECT COUNT(*) as count FROM message').get() as { count: number }
    assert.equal(row.count, 1)
  } finally {
    db.close()
  }
})

test('deduplicates initial push batch when a no-platform-id message is repeated with platform id', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const manager = createDatabaseManager(tempDir)
  const payload: PushImportPayload = {
    chatlab: { version: '0.0.2', exportedAt: 1780330900 },
    meta: { name: 'Push Import Session', platform: 'wechat', type: 'private' },
    members: [{ platformId: 'wxid_alice', accountName: 'Alice' }],
    messages: [
      {
        sender: 'wxid_alice',
        accountName: 'Alice',
        timestamp: 1780330832,
        type: 0,
        content: 'same content',
      },
      {
        platformMessageId: 'msg-1',
        sender: 'wxid_alice',
        accountName: 'Alice',
        timestamp: 1780330832,
        type: 0,
        content: 'same content',
      },
    ],
  }

  const outcome = await pushImport(manager, 'initial-reverse-dedup', payload)
  assert.equal(outcome.ok, true)
  if (!outcome.ok) return
  assert.deepEqual(outcome.result.batch, {
    receivedCount: 2,
    writtenCount: 1,
    duplicateCount: 1,
  })

  const db = manager.openRawSessionDatabase('initial-reverse-dedup', { readonly: true })
  try {
    const row = db.prepare('SELECT COUNT(*) as count FROM message').get() as { count: number }
    assert.equal(row.count, 1)
  } finally {
    db.close()
  }
})

test('counts explicit and auto-created members in initial push import results', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const manager = createDatabaseManager(tempDir)
  const outcome = await pushImport(manager, 'initial-auto-member-count', {
    chatlab: { version: '0.0.2', exportedAt: 1780330900 },
    meta: { name: 'Initial Auto Member Count', platform: 'wechat', type: 'group' },
    members: [{ platformId: 'wxid_alice', accountName: 'Alice' }],
    messages: [
      { sender: 'wxid_alice', timestamp: 1780330832, type: 0, content: 'hello' },
      { sender: 'wxid_bob', accountName: 'Bob', timestamp: 1780330833, type: 0, content: 'hi' },
      { sender: 'SYSTEM', timestamp: 1780330834, type: 80, content: 'Bob joined the group' },
    ],
  })

  assert.equal(outcome.ok, true)
  if (!outcome.ok) return
  assert.equal(outcome.result.session.memberCount, 2)
  assert.deepEqual(outcome.result.updates, {
    metaUpdated: true,
    membersAdded: 2,
    membersUpdated: 0,
  })

  const db = manager.openRawSessionDatabase('initial-auto-member-count', { readonly: true })
  try {
    const row = db.prepare('SELECT COUNT(*) as count FROM member').get() as { count: number }
    assert.equal(row.count, 3)
  } finally {
    db.close()
  }
})

test('deduplicates incremental push when a later platform-id message matches an existing content hash', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const manager = createDatabaseManager(tempDir)
  const initialPayload: PushImportPayload = {
    chatlab: { version: '0.0.2', exportedAt: 1780330900 },
    meta: { name: 'Push Import Session', platform: 'wechat', type: 'private' },
    members: [{ platformId: 'wxid_alice', accountName: 'Alice' }],
    messages: [
      {
        sender: 'wxid_alice',
        accountName: 'Alice',
        timestamp: 1780330832,
        type: 0,
        content: 'same content',
      },
    ],
  }

  const initialOutcome = await pushImport(manager, 'incremental-pmid-hash-dedup', initialPayload)
  assert.equal(initialOutcome.ok, true)

  const duplicatePayload: PushImportPayload = {
    messages: [
      {
        platformMessageId: 'msg-1',
        sender: 'wxid_alice',
        accountName: 'Alice',
        timestamp: 1780330832,
        type: 0,
        content: 'same content',
      },
    ],
  }

  const outcome = await pushImport(manager, 'incremental-pmid-hash-dedup', duplicatePayload)
  assert.equal(outcome.ok, true)
  if (!outcome.ok) return
  assert.deepEqual(outcome.result.batch, {
    receivedCount: 1,
    writtenCount: 0,
    duplicateCount: 1,
  })

  const db = manager.openRawSessionDatabase('incremental-pmid-hash-dedup', { readonly: true })
  try {
    const row = db.prepare('SELECT COUNT(*) as count FROM message').get() as { count: number }
    assert.equal(row.count, 1)
  } finally {
    db.close()
  }
})

test('keeps distinct platform messages even when timestamp, sender and content match', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const manager = createDatabaseManager(tempDir)
  const initialPayload: PushImportPayload = {
    chatlab: { version: '0.0.2', exportedAt: 1780330900 },
    meta: { name: 'Distinct Platform Messages', platform: 'wechat', type: 'private' },
    members: [{ platformId: 'wxid_alice', accountName: 'Alice' }],
    messages: [
      {
        platformMessageId: 'msg-1',
        sender: 'wxid_alice',
        accountName: 'Alice',
        timestamp: 1780330832,
        type: 0,
        content: 'same content',
      },
    ],
  }

  const initialOutcome = await pushImport(manager, 'distinct-platform-messages', initialPayload)
  assert.equal(initialOutcome.ok, true)

  const outcome = await pushImport(manager, 'distinct-platform-messages', {
    messages: [
      {
        platformMessageId: 'msg-2',
        sender: 'wxid_alice',
        accountName: 'Alice',
        timestamp: 1780330832,
        type: 0,
        content: 'same content',
      },
    ],
  })

  assert.equal(outcome.ok, true)
  if (!outcome.ok) return
  assert.deepEqual(outcome.result.batch, {
    receivedCount: 1,
    writtenCount: 1,
    duplicateCount: 0,
  })

  const db = manager.openRawSessionDatabase('distinct-platform-messages', { readonly: true })
  try {
    const row = db.prepare('SELECT COUNT(*) as count FROM message').get() as { count: number }
    assert.equal(row.count, 2)
  } finally {
    db.close()
  }
})

test('preserves metadata and counts senders auto-created by incremental push imports', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const manager = createDatabaseManager(tempDir)
  const initialOutcome = await pushImport(manager, 'incremental-auto-member', {
    chatlab: { version: '0.0.2', exportedAt: 1780330900 },
    meta: { name: 'Incremental Auto Member', platform: 'wechat', type: 'group' },
    members: [{ platformId: 'wxid_alice', accountName: 'Alice' }],
    messages: [{ sender: 'wxid_alice', timestamp: 1780330832, type: 0, content: 'hello' }],
  })
  assert.equal(initialOutcome.ok, true)

  const outcome = await pushImport(manager, 'incremental-auto-member', {
    messages: [
      {
        sender: 'wxid_bob',
        accountName: 'Bob',
        groupNickname: 'Product',
        timestamp: 1780330833,
        type: 0,
        content: 'hi',
      },
    ],
  })

  assert.equal(outcome.ok, true)
  if (!outcome.ok) return
  assert.deepEqual(outcome.result.updates, {
    metaUpdated: false,
    membersAdded: 1,
    membersUpdated: 0,
  })

  const db = manager.openRawSessionDatabase('incremental-auto-member', { readonly: true })
  try {
    const member = db
      .prepare('SELECT platform_id, account_name, group_nickname FROM member WHERE platform_id = ?')
      .get('wxid_bob') as { platform_id: string; account_name: string; group_nickname: string }
    assert.deepEqual(member, {
      platform_id: 'wxid_bob',
      account_name: 'Bob',
      group_nickname: 'Product',
    })
  } finally {
    db.close()
  }
})

test('creates push-import databases only inside the canonical databases directory', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const manager = createDatabaseManager(tempDir)
  const outcome = await pushImport(manager, 'canonical-path', {
    chatlab: { version: '0.0.2', exportedAt: 1780330900 },
    meta: { name: 'Canonical Path', platform: 'wechat', type: 'private' },
    messages: [{ sender: 'wxid_alice', timestamp: 1780330832, type: 0, content: 'hello' }],
  })

  assert.equal(outcome.ok, true)
  assert.equal(fs.existsSync(path.join(tempDir, 'databases', 'canonical-path.db')), true)
  assert.equal(fs.existsSync(path.join(tempDir, 'canonical-path.db')), false)
})

test('rejects malformed incremental fields before applying updates', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const manager = createDatabaseManager(tempDir)
  const sessionId = 'invalid-incremental-payload'
  const initialOutcome = await pushImport(manager, sessionId, {
    chatlab: { version: '0.0.2', exportedAt: 1780330900 },
    meta: { name: 'Original Session', platform: 'wechat', type: 'private' },
    members: [{ platformId: 'wxid_alice', accountName: 'Alice', groupNickname: 'Original Member' }],
    messages: [
      {
        sender: 'wxid_alice',
        accountName: 'Alice',
        timestamp: 1780330832,
        type: 0,
        content: 'hello',
      },
    ],
  })
  assert.equal(initialOutcome.ok, true)

  const validMessage = {
    sender: 'wxid_alice',
    timestamp: 1780330833,
    type: 0,
    content: 'still valid',
  }
  const invalidPayloads: Array<{ name: string; payload: unknown }> = [
    {
      name: 'messages must be an array',
      payload: { meta: { name: 'Renamed Session' }, messages: {} },
    },
    {
      name: 'members must be an array',
      payload: { meta: { name: 'Renamed Session' }, members: {}, messages: [validMessage] },
    },
    {
      name: 'member platform IDs must be strings',
      payload: {
        meta: { name: 'Renamed Session' },
        members: [{ platformId: { id: 'wxid_alice' }, accountName: 'Alice' }],
        messages: [validMessage],
      },
    },
    {
      name: 'message senders must be strings',
      payload: {
        meta: { name: 'Renamed Session' },
        messages: [{ ...validMessage, sender: { id: 'wxid_alice' } }],
      },
    },
    {
      name: 'reply targets must be strings',
      payload: {
        meta: { name: 'Renamed Session' },
        messages: [{ ...validMessage, replyToMessageId: { id: 'msg-1' } }],
      },
    },
    {
      name: 'message metadata must have the documented types',
      payload: {
        meta: { name: 'Renamed Session' },
        members: [{ platformId: 'wxid_alice', groupNickname: 'Updated Member' }],
        messages: [{ ...validMessage, accountName: { invalid: true } }],
      },
    },
  ]

  for (const { name, payload } of invalidPayloads) {
    const outcome = await pushImport(manager, sessionId, payload as PushImportPayload)
    assert.equal(outcome.ok, false, name)
    if (!outcome.ok) assert.equal(outcome.reason, 'invalid_payload', name)
  }

  const db = manager.openRawSessionDatabase(sessionId, { readonly: true })
  try {
    const meta = db.prepare('SELECT name FROM meta').get() as { name: string }
    const member = db.prepare('SELECT group_nickname FROM member WHERE platform_id = ?').get('wxid_alice') as {
      group_nickname: string
    }
    const messages = db.prepare('SELECT COUNT(*) AS count FROM message').get() as { count: number }

    assert.deepEqual(
      {
        metaName: meta.name,
        memberName: member.group_nickname,
        messageCount: messages.count,
      },
      {
        metaName: 'Original Session',
        memberName: 'Original Member',
        messageCount: 1,
      }
    )
  } finally {
    db.close()
  }
})

test('rolls back metadata and member updates when incremental message writes fail', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const manager = createDatabaseManager(tempDir)
  const initialOutcome = await pushImport(manager, 'atomic-message-write', {
    chatlab: { version: '0.0.2', exportedAt: 1780330900 },
    meta: { name: 'Original Session', platform: 'wechat', type: 'private' },
    members: [{ platformId: 'wxid_alice', accountName: 'Alice', groupNickname: 'Original Member' }],
    messages: [
      {
        sender: 'wxid_alice',
        accountName: 'Alice',
        timestamp: 1780330832,
        type: 0,
        content: 'hello',
      },
    ],
  })
  assert.equal(initialOutcome.ok, true)

  const writableDb = manager.openRawSessionDatabase('atomic-message-write', { readonly: false })
  try {
    writableDb.exec(`
      CREATE TRIGGER fail_incremental_message_insert
      BEFORE INSERT ON message
      BEGIN
        SELECT RAISE(ABORT, 'forced message write failure');
      END
    `)
  } finally {
    writableDb.close()
  }

  const outcome = await pushImport(manager, 'atomic-message-write', {
    meta: { name: 'Renamed Session', platform: 'wechat', type: 'private' },
    members: [{ platformId: 'wxid_alice', groupNickname: 'Updated Member' }],
    messages: [
      {
        sender: 'wxid_alice',
        accountName: 'Alice',
        timestamp: 1780330833,
        type: 0,
        content: 'should fail',
      },
    ],
  })

  const db = manager.openRawSessionDatabase('atomic-message-write', { readonly: true })
  try {
    const meta = db.prepare('SELECT name FROM meta').get() as { name: string }
    const member = db.prepare('SELECT group_nickname FROM member WHERE platform_id = ?').get('wxid_alice') as {
      group_nickname: string
    }
    const messages = db.prepare('SELECT COUNT(*) AS count FROM message').get() as { count: number }

    assert.deepEqual(
      {
        reason: outcome.ok ? 'ok' : outcome.reason,
        metaName: meta.name,
        memberName: member.group_nickname,
        messageCount: messages.count,
      },
      {
        reason: 'import_failed',
        metaName: 'Original Session',
        memberName: 'Original Member',
        messageCount: 1,
      }
    )
  } finally {
    db.close()
  }
})

test('treats auto-created SYSTEM sender as a system member during initial import', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const manager = createDatabaseManager(tempDir)
  const payload: PushImportPayload = {
    chatlab: { version: '0.0.2', exportedAt: 1780330900 },
    meta: { name: 'System Session', platform: 'wechat', type: 'group' },
    messages: [
      {
        sender: 'SYSTEM',
        timestamp: 1780330832,
        type: 80,
        content: 'Alice joined the group',
      },
    ],
  }

  const outcome = await pushImport(manager, 'system-sender', payload)
  assert.equal(outcome.ok, true)
  if (!outcome.ok) return
  assert.equal(outcome.result.session.memberCount, 0)
  assert.equal(outcome.result.updates.membersAdded, 0)

  const db = manager.openRawSessionDatabase('system-sender', { readonly: true })
  try {
    const member = db.prepare('SELECT platform_id, account_name FROM member').get() as {
      platform_id: string
      account_name: string
    }
    assert.deepEqual(member, {
      platform_id: 'SYSTEM',
      account_name: '系统消息',
    })
  } finally {
    db.close()
  }
})

test('excludes an auto-created SYSTEM sender from incremental member counts', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const manager = createDatabaseManager(tempDir)
  const initialOutcome = await pushImport(manager, 'incremental-system-count', {
    chatlab: { version: '0.0.2', exportedAt: 1780330900 },
    meta: { name: 'System Count', platform: 'wechat', type: 'group' },
    members: [{ platformId: 'wxid_alice', accountName: 'Alice' }],
    messages: [{ sender: 'wxid_alice', accountName: 'Alice', timestamp: 1780330832, type: 0, content: 'hello' }],
  })
  assert.equal(initialOutcome.ok, true)

  const outcome = await pushImport(manager, 'incremental-system-count', {
    messages: [{ sender: 'SYSTEM', timestamp: 1780330833, type: 80, content: 'Bob joined the group' }],
  })

  assert.equal(outcome.ok, true)
  if (!outcome.ok) return
  assert.equal(outcome.result.session.memberCount, 1)
  assert.deepEqual(outcome.result.updates, {
    metaUpdated: false,
    membersAdded: 0,
    membersUpdated: 0,
  })

  const db = manager.openRawSessionDatabase('incremental-system-count', { readonly: true })
  try {
    const members = db.prepare('SELECT platform_id, account_name FROM member ORDER BY platform_id').all()
    assert.deepEqual(members, [
      { platform_id: 'SYSTEM', account_name: '系统消息' },
      { platform_id: 'wxid_alice', account_name: 'Alice' },
    ])
  } finally {
    db.close()
  }
})

test('keeps SYSTEM member canonical during incremental member upserts', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const manager = createDatabaseManager(tempDir)
  const initialPayload: PushImportPayload = {
    chatlab: { version: '0.0.2', exportedAt: 1780330900 },
    meta: { name: 'System Session', platform: 'wechat', type: 'group' },
    messages: [
      {
        sender: 'SYSTEM',
        timestamp: 1780330832,
        type: 80,
        content: 'Alice joined the group',
      },
    ],
  }

  const initialOutcome = await pushImport(manager, 'system-member-upsert', initialPayload)
  assert.equal(initialOutcome.ok, true)

  const incrementalPayload: PushImportPayload = {
    members: [{ platformId: 'SYSTEM', accountName: 'Bot' }],
    messages: [
      {
        sender: 'SYSTEM',
        timestamp: 1780330833,
        type: 80,
        content: 'Bob joined the group',
      },
    ],
  }

  const outcome = await pushImport(manager, 'system-member-upsert', incrementalPayload)
  assert.equal(outcome.ok, true)
  if (!outcome.ok) return
  assert.equal(outcome.result.session.memberCount, 0)
  assert.deepEqual(outcome.result.updates, {
    metaUpdated: false,
    membersAdded: 0,
    membersUpdated: 0,
  })

  const db = manager.openRawSessionDatabase('system-member-upsert', { readonly: true })
  try {
    const member = db.prepare('SELECT platform_id, account_name FROM member').get() as {
      platform_id: string
      account_name: string
    }
    assert.deepEqual(member, {
      platform_id: 'SYSTEM',
      account_name: '系统消息',
    })
  } finally {
    db.close()
  }
})
