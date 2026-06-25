import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DatabaseManager } from '../database-manager'
import type { PushImportPayload } from './push-importer'
import { pushImport } from './push-importer'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

function makeTempDir(): string {
  const baseDir = fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir()
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-push-import-'))
}

function createDatabaseManager(rootDir: string): DatabaseManager {
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
    { nativeBinding, allowMissingRuntimeForTests: true }
  )
}

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

test('rejects non-array messages before applying incremental metadata updates', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const manager = createDatabaseManager(tempDir)
  const initialPayload: PushImportPayload = {
    chatlab: { version: '0.0.2', exportedAt: 1780330900 },
    meta: { name: 'Original Session', platform: 'wechat', type: 'private' },
    members: [{ platformId: 'wxid_alice', accountName: 'Alice' }],
    messages: [
      {
        sender: 'wxid_alice',
        accountName: 'Alice',
        timestamp: 1780330832,
        type: 0,
        content: 'hello',
      },
    ],
  }

  const initialOutcome = await pushImport(manager, 'invalid-messages', initialPayload)
  assert.equal(initialOutcome.ok, true)

  const malformedPayload = {
    meta: { name: 'Renamed Session', platform: 'wechat', type: 'private' },
    messages: {},
  } as unknown as PushImportPayload

  const outcome = await pushImport(manager, 'invalid-messages', malformedPayload)
  assert.equal(outcome.ok, false)
  if (outcome.ok) return
  assert.equal(outcome.reason, 'invalid_payload')

  const db = manager.openRawSessionDatabase('invalid-messages', { readonly: true })
  try {
    const row = db.prepare('SELECT name FROM meta').get() as { name: string }
    assert.equal(row.name, 'Original Session')
  } finally {
    db.close()
  }
})

test('rejects non-array members before applying incremental metadata updates', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const manager = createDatabaseManager(tempDir)
  const initialPayload: PushImportPayload = {
    chatlab: { version: '0.0.2', exportedAt: 1780330900 },
    meta: { name: 'Original Session', platform: 'wechat', type: 'private' },
    members: [{ platformId: 'wxid_alice', accountName: 'Alice' }],
    messages: [
      {
        sender: 'wxid_alice',
        accountName: 'Alice',
        timestamp: 1780330832,
        type: 0,
        content: 'hello',
      },
    ],
  }

  const initialOutcome = await pushImport(manager, 'invalid-members', initialPayload)
  assert.equal(initialOutcome.ok, true)

  const malformedPayload = {
    meta: { name: 'Renamed Session', platform: 'wechat', type: 'private' },
    members: {},
    messages: [
      {
        sender: 'wxid_alice',
        timestamp: 1780330833,
        type: 0,
        content: 'still valid',
      },
    ],
  } as unknown as PushImportPayload

  const outcome = await pushImport(manager, 'invalid-members', malformedPayload)
  assert.equal(outcome.ok, false)
  if (outcome.ok) return
  assert.equal(outcome.reason, 'invalid_payload')

  const db = manager.openRawSessionDatabase('invalid-members', { readonly: true })
  try {
    const row = db.prepare('SELECT name FROM meta').get() as { name: string }
    assert.equal(row.name, 'Original Session')
  } finally {
    db.close()
  }
})

test('rejects non-string member platform IDs before applying incremental metadata updates', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const manager = createDatabaseManager(tempDir)
  const initialPayload: PushImportPayload = {
    chatlab: { version: '0.0.2', exportedAt: 1780330900 },
    meta: { name: 'Original Session', platform: 'wechat', type: 'private' },
    members: [{ platformId: 'wxid_alice', accountName: 'Alice' }],
    messages: [
      {
        sender: 'wxid_alice',
        accountName: 'Alice',
        timestamp: 1780330832,
        type: 0,
        content: 'hello',
      },
    ],
  }

  const initialOutcome = await pushImport(manager, 'invalid-member-platform-id', initialPayload)
  assert.equal(initialOutcome.ok, true)

  const malformedPayload = {
    meta: { name: 'Renamed Session', platform: 'wechat', type: 'private' },
    members: [{ platformId: { id: 'wxid_alice' }, accountName: 'Alice' }],
    messages: [
      {
        sender: 'wxid_alice',
        timestamp: 1780330833,
        type: 0,
        content: 'still valid',
      },
    ],
  } as unknown as PushImportPayload

  const outcome = await pushImport(manager, 'invalid-member-platform-id', malformedPayload)
  assert.equal(outcome.ok, false)
  if (outcome.ok) return
  assert.equal(outcome.reason, 'invalid_payload')

  const db = manager.openRawSessionDatabase('invalid-member-platform-id', { readonly: true })
  try {
    const row = db.prepare('SELECT name FROM meta').get() as { name: string }
    assert.equal(row.name, 'Original Session')
  } finally {
    db.close()
  }
})

test('rejects non-string message senders before applying incremental metadata updates', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const manager = createDatabaseManager(tempDir)
  const initialPayload: PushImportPayload = {
    chatlab: { version: '0.0.2', exportedAt: 1780330900 },
    meta: { name: 'Original Session', platform: 'wechat', type: 'private' },
    members: [{ platformId: 'wxid_alice', accountName: 'Alice' }],
    messages: [
      {
        sender: 'wxid_alice',
        accountName: 'Alice',
        timestamp: 1780330832,
        type: 0,
        content: 'hello',
      },
    ],
  }

  const initialOutcome = await pushImport(manager, 'invalid-sender', initialPayload)
  assert.equal(initialOutcome.ok, true)

  const malformedPayload = {
    meta: { name: 'Renamed Session', platform: 'wechat', type: 'private' },
    messages: [
      {
        sender: { id: 'wxid_alice' },
        timestamp: 1780330833,
        type: 0,
        content: 'still valid',
      },
    ],
  } as unknown as PushImportPayload

  const outcome = await pushImport(manager, 'invalid-sender', malformedPayload)
  assert.equal(outcome.ok, false)
  if (outcome.ok) return
  assert.equal(outcome.reason, 'invalid_payload')

  const db = manager.openRawSessionDatabase('invalid-sender', { readonly: true })
  try {
    const row = db.prepare('SELECT name FROM meta').get() as { name: string }
    assert.equal(row.name, 'Original Session')
  } finally {
    db.close()
  }
})

test('rejects non-string reply targets before applying incremental metadata updates', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const manager = createDatabaseManager(tempDir)
  const initialPayload: PushImportPayload = {
    chatlab: { version: '0.0.2', exportedAt: 1780330900 },
    meta: { name: 'Original Session', platform: 'wechat', type: 'private' },
    members: [{ platformId: 'wxid_alice', accountName: 'Alice' }],
    messages: [
      {
        sender: 'wxid_alice',
        accountName: 'Alice',
        timestamp: 1780330832,
        type: 0,
        content: 'hello',
      },
    ],
  }

  const initialOutcome = await pushImport(manager, 'invalid-reply-target', initialPayload)
  assert.equal(initialOutcome.ok, true)

  const malformedPayload = {
    meta: { name: 'Renamed Session', platform: 'wechat', type: 'private' },
    messages: [
      {
        sender: 'wxid_alice',
        timestamp: 1780330833,
        type: 0,
        content: 'still valid',
        replyToMessageId: { id: 'msg-1' },
      },
    ],
  } as unknown as PushImportPayload

  const outcome = await pushImport(manager, 'invalid-reply-target', malformedPayload)
  assert.equal(outcome.ok, false)
  if (outcome.ok) return
  assert.equal(outcome.reason, 'invalid_payload')

  const db = manager.openRawSessionDatabase('invalid-reply-target', { readonly: true })
  try {
    const row = db.prepare('SELECT name FROM meta').get() as { name: string }
    assert.equal(row.name, 'Original Session')
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
