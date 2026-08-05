import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { CHAT_DB_SCHEMA } from '@openchatlab/core'
import { MessageType, type ParsedMessage } from '@openchatlab/shared-types'
import { openBetterSqliteDatabase } from '../better-sqlite3-adapter'
import { resolveAutoImportTarget, resolveAutoImportTargetPlan, type AutoImportMatcherDeps } from './auto-import-matcher'
import { autoImportFile } from './auto-importer'
import { incrementalImport } from './incremental-importer'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

interface SourceMeta {
  name: string
  platform: string
  type: 'group' | 'private'
  groupId?: string
  ownerId?: string
}

interface SourceMember {
  platformId: string
  accountName: string
}

function makeTempDir(): string {
  const baseDir = process.env.CHATLAB_TEST_TMPDIR ?? (fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir())
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-auto-import-match-'))
}

function writeChatLabJsonl(
  filePath: string,
  meta: SourceMeta,
  members: SourceMember[],
  messages: ParsedMessage[],
  sourceSessionId?: string
): void {
  const lines = [
    {
      _type: 'header',
      chatlab: { version: '0.0.2', exportedAt: 1783840000 },
      meta: { ...meta, sourceSessionId },
    },
    ...members.map((member) => ({ _type: 'member', ...member })),
    ...messages.map((message) => ({
      _type: 'message',
      sender: message.senderPlatformId,
      accountName: message.senderAccountName,
      timestamp: message.timestamp,
      type: message.type,
      content: message.content,
      platformMessageId: message.platformMessageId,
      replyToMessageId: message.replyToMessageId,
    })),
  ]
  fs.writeFileSync(filePath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8')
}

function seedSession(dbPath: string, meta: SourceMeta, members: SourceMember[], messages: ParsedMessage[]): void {
  const db = openBetterSqliteDatabase(dbPath, { nativeBinding })
  db.exec(CHAT_DB_SCHEMA)
  db.prepare(
    `INSERT INTO meta (name, platform, type, imported_at, group_id, owner_id, schema_version)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(meta.name, meta.platform, meta.type, 1783840000, meta.groupId ?? null, meta.ownerId ?? null, 6)

  const insertMember = db.prepare('INSERT INTO member (platform_id, account_name) VALUES (?, ?)')
  const insertMessage = db.prepare(
    `INSERT INTO message (
       sender_id, sender_account_name, ts, type, content, platform_message_id, reply_to_message_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  const memberIds = new Map<string, number>()
  for (const member of members) {
    const result = insertMember.run(member.platformId, member.accountName)
    memberIds.set(member.platformId, Number(result.lastInsertRowid))
  }
  for (const message of messages) {
    const senderId = memberIds.get(message.senderPlatformId)
    assert.ok(senderId, `missing member ${message.senderPlatformId}`)
    insertMessage.run(
      senderId,
      message.senderAccountName,
      message.timestamp,
      message.type,
      message.content,
      message.platformMessageId ?? null,
      message.replyToMessageId ?? null
    )
  }
  db.close()
}

function createDeps(tempDir: string, sessionIds: string[]): AutoImportMatcherDeps {
  return {
    listSessionIds: () => sessionIds,
    openReadonly: (sessionId) =>
      openBetterSqliteDatabase(path.join(tempDir, `${sessionId}.db`), { readonly: true, nativeBinding }),
  }
}

function textMessage(sender: string, timestamp: number, content: string, type = MessageType.TEXT): ParsedMessage {
  return {
    senderPlatformId: sender,
    senderAccountName: sender,
    timestamp,
    type,
    content,
  }
}

test('derives a hashed parallel key only from a stable source identity', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))
  const sourcePath = path.join(tempDir, 'source.jsonl')
  writeChatLabJsonl(
    sourcePath,
    { name: 'New group', platform: 'qq', type: 'group', groupId: 'private-group-id' },
    [{ platformId: 'user-1', accountName: 'Alice' }],
    [textMessage('user-1', 1783840001, 'hello')]
  )

  const plan = await resolveAutoImportTargetPlan(sourcePath, createDeps(tempDir, []))

  assert.deepEqual(plan.decision, { action: 'create', reason: 'no-match' })
  assert.match(plan.concurrencyKey, /^source:[a-f0-9]{64}$/)
  assert.doesNotMatch(plan.concurrencyKey, /private-group-id/)
  assert.equal(plan.exclusive, false)
  assert.equal(plan.coalesceCreate, true)
})

test('makes sources without a stable identity exclusive', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))
  const sourcePath = path.join(tempDir, 'source.jsonl')
  writeChatLabJsonl(
    sourcePath,
    { name: 'Unknown private chat', platform: 'line', type: 'private' },
    [{ platformId: 'Alice', accountName: 'Alice' }],
    [textMessage('Alice', 1783840001, 'hello')]
  )

  const plan = await resolveAutoImportTargetPlan(sourcePath, createDeps(tempDir, []))

  assert.deepEqual(plan, {
    decision: { action: 'create', reason: 'no-match' },
    concurrencyKey: 'unresolved',
    exclusive: true,
    coalesceCreate: false,
  })
})

test('matches a unique group session by stable group id', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const meta: SourceMeta = {
    name: 'Renamed group',
    platform: 'qq',
    type: 'group',
    groupId: 'group-42',
  }
  const members = [{ platformId: 'user-1', accountName: 'Alice' }]
  const messages: ParsedMessage[] = [
    {
      senderPlatformId: 'user-1',
      senderAccountName: 'Alice',
      timestamp: 1783840001,
      type: MessageType.TEXT,
      content: 'new message',
    },
  ]

  seedSession(path.join(tempDir, 'existing.db'), { ...meta, name: 'Old group name' }, members, messages)
  writeChatLabJsonl(path.join(tempDir, 'source.jsonl'), meta, members, messages)

  assert.deepEqual(
    await resolveAutoImportTarget(path.join(tempDir, 'source.jsonl'), createDeps(tempDir, ['existing'])),
    {
      action: 'incremental',
      sessionId: 'existing',
      matchedBy: 'stable-id',
    }
  )
})

test('matches a unique private session by stable owner and participant ids', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const meta: SourceMeta = {
    name: 'Peer renamed',
    platform: 'google-chat',
    type: 'private',
    ownerId: 'owner@example.com',
  }
  const members = [
    { platformId: 'owner@example.com', accountName: 'Owner' },
    { platformId: 'peer@example.com', accountName: 'Peer' },
  ]
  const messages: ParsedMessage[] = [
    {
      senderPlatformId: 'peer@example.com',
      senderAccountName: 'Peer',
      timestamp: 1783840100,
      type: MessageType.TEXT,
      content: 'hello',
    },
  ]

  seedSession(path.join(tempDir, 'private-existing.db'), { ...meta, name: 'Old peer name' }, members, messages)
  writeChatLabJsonl(path.join(tempDir, 'private-source.jsonl'), meta, members, messages)

  assert.deepEqual(
    await resolveAutoImportTarget(
      path.join(tempDir, 'private-source.jsonl'),
      createDeps(tempDir, ['private-existing'])
    ),
    {
      action: 'incremental',
      sessionId: 'private-existing',
      matchedBy: 'stable-id',
    }
  )
})

test('keeps the owner role when matching private sessions with the same participants', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const members = [
    { platformId: 'account-a', accountName: 'Account A' },
    { platformId: 'account-b', accountName: 'Account B' },
  ]
  const messages = [textMessage('account-b', 1783840110, 'hello')]
  const sourceMeta: SourceMeta = {
    name: 'Private chat',
    platform: 'qq',
    type: 'private',
    ownerId: 'account-b',
  }

  seedSession(path.join(tempDir, 'account-a.db'), { ...sourceMeta, ownerId: 'account-a' }, members, messages)
  seedSession(path.join(tempDir, 'account-b.db'), sourceMeta, members, messages)
  const sourcePath = path.join(tempDir, 'source.jsonl')
  writeChatLabJsonl(sourcePath, sourceMeta, members, messages)

  assert.deepEqual(await resolveAutoImportTarget(sourcePath, createDeps(tempDir, ['account-a', 'account-b'])), {
    action: 'incremental',
    sessionId: 'account-b',
    matchedBy: 'stable-id',
  })
})

test('matches a private session by its complete participant set when owner metadata is missing', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const meta: SourceMeta = {
    name: 'Private chat',
    platform: 'qq',
    type: 'private',
  }
  const members = [
    { platformId: '10001', accountName: 'Owner' },
    { platformId: '20002', accountName: 'Peer' },
  ]
  const messages = [textMessage('20002', 1783840120, 'hello')]

  seedSession(path.join(tempDir, 'existing.db'), meta, members, messages)
  const sourcePath = path.join(tempDir, 'source.jsonl')
  writeChatLabJsonl(sourcePath, meta, members, messages)

  assert.deepEqual(await resolveAutoImportTarget(sourcePath, createDeps(tempDir, ['existing'])), {
    action: 'incremental',
    sessionId: 'existing',
    matchedBy: 'stable-id',
  })
})

test('matches an owned QQ private session when the import source omits owner metadata', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const sourceMeta: SourceMeta = {
    name: 'Private chat',
    platform: 'qq',
    type: 'private',
  }
  const members = [
    { platformId: '10001', accountName: 'Owner' },
    { platformId: '20002', accountName: 'Peer' },
  ]
  const messages = [textMessage('20002', 1783840130, 'hello')]

  seedSession(path.join(tempDir, 'existing.db'), { ...sourceMeta, ownerId: '10001' }, members, messages)
  const sourcePath = path.join(tempDir, 'source.jsonl')
  writeChatLabJsonl(sourcePath, sourceMeta, members, messages)

  assert.deepEqual(await resolveAutoImportTarget(sourcePath, createDeps(tempDir, ['existing'])), {
    action: 'incremental',
    sessionId: 'existing',
    matchedBy: 'stable-id',
  })
})

test('falls back to trailing messages when private stable identity has drifted', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const sourceMeta: SourceMeta = {
    name: 'Private chat',
    platform: 'line',
    type: 'private',
    ownerId: 'owner',
  }
  const candidateMembers = [
    { platformId: 'owner', accountName: 'Owner' },
    { platformId: 'peer', accountName: 'Peer' },
  ]
  const sourceMembers = [...candidateMembers, { platformId: 'new-device-member', accountName: 'Peer' }]
  const messages = [
    textMessage('owner', 1783840151, 'one'),
    textMessage('peer', 1783840152, 'two'),
    textMessage('owner', 1783840153, 'three'),
    textMessage('peer', 1783840154, 'four'),
    textMessage('owner', 1783840155, 'five'),
  ]

  seedSession(path.join(tempDir, 'existing.db'), sourceMeta, candidateMembers, messages)
  const sourcePath = path.join(tempDir, 'source.jsonl')
  writeChatLabJsonl(sourcePath, sourceMeta, sourceMembers, messages)

  assert.deepEqual(await resolveAutoImportTarget(sourcePath, createDeps(tempDir, ['existing'])), {
    action: 'incremental',
    sessionId: 'existing',
    matchedBy: 'trailing-messages',
  })
})

test('matches QQ private exports across UID and UIN drift using platform message ids', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const candidateMeta: SourceMeta = {
    name: 'Private chat',
    platform: 'qq',
    type: 'private',
    ownerId: 'uid-owner',
  }
  const sourceMeta: SourceMeta = {
    ...candidateMeta,
    ownerId: '10001',
  }
  const candidateMembers = [
    { platformId: 'uid-owner', accountName: 'Owner' },
    { platformId: 'uid-peer', accountName: 'Peer' },
  ]
  const sourceMembers = [
    { platformId: '10001', accountName: 'Owner' },
    { platformId: '20002', accountName: 'Peer' },
  ]
  const candidateMessages = Array.from({ length: 5 }, (_, index) => ({
    ...textMessage(index % 2 === 0 ? 'uid-peer' : 'uid-owner', 1783840140 + index, `message ${index}`),
    platformMessageId: `message-${index}`,
  }))
  const sourceMessages = candidateMessages.map((message, index) => ({
    ...message,
    senderPlatformId: index % 2 === 0 ? '20002' : '10001',
  }))

  seedSession(path.join(tempDir, 'existing.db'), candidateMeta, candidateMembers, candidateMessages)
  const sourcePath = path.join(tempDir, 'source.jsonl')
  writeChatLabJsonl(sourcePath, sourceMeta, sourceMembers, sourceMessages)

  assert.deepEqual(await resolveAutoImportTarget(sourcePath, createDeps(tempDir, ['existing'])), {
    action: 'incremental',
    sessionId: 'existing',
    matchedBy: 'trailing-messages',
    senderPlatformIdMappings: [
      { sourceId: '10001', targetId: 'uid-owner' },
      { sourceId: '20002', targetId: 'uid-peer' },
    ],
  })
})

test('auto import reuses existing QQ members across UID and UIN drift', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const candidateMeta: SourceMeta = {
    name: 'Private chat',
    platform: 'qq',
    type: 'private',
    ownerId: 'uid-owner',
  }
  const sourceMeta: SourceMeta = {
    name: 'Private chat',
    platform: 'qq',
    type: 'private',
  }
  const candidateMembers = [
    { platformId: 'uid-owner', accountName: 'Owner' },
    { platformId: 'uid-peer', accountName: 'Peer' },
  ]
  const sourceMembers = [
    { platformId: '10001', accountName: 'Owner' },
    { platformId: '20002', accountName: 'Peer' },
  ]
  const candidateMessages = Array.from({ length: 5 }, (_, index) => ({
    ...textMessage(index % 2 === 0 ? 'uid-peer' : 'uid-owner', 1783840140 + index, `message ${index}`),
    platformMessageId: `message-${index}`,
  }))
  const sourceMessages = [
    ...candidateMessages.map((message, index) => ({
      ...message,
      senderPlatformId: index % 2 === 0 ? '20002' : '10001',
    })),
    {
      ...textMessage('20002', 1783840145, 'new message'),
      platformMessageId: 'message-5',
    },
  ]

  seedSession(path.join(tempDir, 'existing.db'), candidateMeta, candidateMembers, candidateMessages)
  const sourcePath = path.join(tempDir, 'source.jsonl')
  writeChatLabJsonl(sourcePath, sourceMeta, sourceMembers, sourceMessages)

  const result = await autoImportFile(sourcePath, {
    ...createDeps(tempDir, ['existing']),
    sessionExists: (sessionId) => sessionId === 'existing',
    createSession: async () => {
      throw new Error('must not create a second session')
    },
    appendSession: (sessionId, filePath, _formatOptions, onProgress, context) =>
      incrementalImport(
        sessionId,
        filePath,
        {
          openDatabase: (_targetSessionId, readonly = false) =>
            openBetterSqliteDatabase(path.join(tempDir, 'existing.db'), { readonly, nativeBinding }),
          onProgress: onProgress ?? (() => {}),
        },
        {
          platformMessageIdScope: context?.platformMessageIdScope,
          senderPlatformIdMappings: context?.senderPlatformIdMappings,
        }
      ),
  })

  assert.equal(result.success, true)
  assert.equal(result.importMode, 'incremental')
  assert.equal(result.matchedBy, 'trailing-messages')
  assert.equal(result.newMessageCount, 1)
  assert.equal(result.duplicateCount, 5)

  const db = openBetterSqliteDatabase(path.join(tempDir, 'existing.db'), { readonly: true, nativeBinding })
  const meta = db.prepare('SELECT owner_id FROM meta').get() as { owner_id: string | null }
  const members = db.prepare('SELECT platform_id FROM member ORDER BY platform_id').all() as Array<{
    platform_id: string
  }>
  const lastSender = db
    .prepare(
      `SELECT member.platform_id
       FROM message
       JOIN member ON member.id = message.sender_id
       ORDER BY message.ts DESC, message.id DESC
       LIMIT 1`
    )
    .get() as { platform_id: string }
  db.close()

  assert.equal(meta.owner_id, 'uid-owner')
  assert.deepEqual(
    members.map((member) => member.platform_id),
    ['uid-owner', 'uid-peer']
  )
  assert.equal(lastSender.platform_id, 'uid-peer')
})

test('does not match sender-agnostic message ids when the member mapping is incomplete', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const meta: SourceMeta = { name: 'Private chat', platform: 'qq', type: 'private' }
  const candidateMembers = [
    { platformId: 'uid-a', accountName: 'A' },
    { platformId: 'uid-b', accountName: 'B' },
    { platformId: 'uid-c', accountName: 'C' },
  ]
  const sourceMembers = [
    { platformId: '10001', accountName: 'A' },
    { platformId: '10002', accountName: 'B' },
    { platformId: '10003', accountName: 'C' },
  ]
  const candidateMessages = Array.from({ length: 5 }, (_, index) => ({
    ...textMessage('uid-a', 1783840150 + index, `message ${index}`),
    platformMessageId: `message-${index}`,
  }))
  const sourceMessages = candidateMessages.map((message) => ({
    ...message,
    senderPlatformId: '10001',
  }))

  seedSession(path.join(tempDir, 'existing.db'), meta, candidateMembers, candidateMessages)
  const sourcePath = path.join(tempDir, 'source.jsonl')
  writeChatLabJsonl(sourcePath, meta, sourceMembers, sourceMessages)

  assert.deepEqual(await resolveAutoImportTarget(sourcePath, createDeps(tempDir, ['existing'])), {
    action: 'create',
    reason: 'no-match',
  })
})

test('does not guess unmatched QQ group members when participants have changed', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const meta: SourceMeta = { name: 'Group chat', platform: 'qq', type: 'group' }
  const candidateMembers = [
    { platformId: 'uid-a', accountName: 'A' },
    { platformId: 'uid-b', accountName: 'B' },
    { platformId: 'uid-c', accountName: 'C' },
  ]
  const sourceMembers = [
    { platformId: '10001', accountName: 'A' },
    { platformId: '10002', accountName: 'B' },
    { platformId: '10004', accountName: 'D' },
  ]
  const candidateMessages = Array.from({ length: 5 }, (_, index) => ({
    ...textMessage(index % 2 === 0 ? 'uid-a' : 'uid-b', 1783840160 + index, `message ${index}`),
    platformMessageId: `message-${index}`,
  }))
  const sourceMessages = [
    ...candidateMessages.map((message, index) => ({
      ...message,
      senderPlatformId: index % 2 === 0 ? '10001' : '10002',
    })),
    {
      ...textMessage('10004', 1783840165, 'new member message'),
      platformMessageId: 'message-5',
    },
  ]

  seedSession(path.join(tempDir, 'existing.db'), meta, candidateMembers, candidateMessages)
  const sourcePath = path.join(tempDir, 'source.jsonl')
  writeChatLabJsonl(sourcePath, meta, sourceMembers, sourceMessages)

  assert.deepEqual(await resolveAutoImportTarget(sourcePath, createDeps(tempDir, ['existing'])), {
    action: 'create',
    reason: 'no-match',
  })
})

test('auto import deduplicates raw IDs against the matched merger scope and keeps new references scoped', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const meta: SourceMeta = { name: 'Private chat', platform: 'qq', type: 'private' }
  const members = [
    { platformId: '10001', accountName: 'Owner' },
    { platformId: '20002', accountName: 'Peer' },
  ]
  const existingRawMessages = Array.from({ length: 5 }, (_, index) => ({
    ...textMessage(index % 2 === 0 ? '20002' : '10001', 1783840150 + index, `message ${index}`),
    platformMessageId: `message-${index}`,
  }))
  const rawMessages = [
    ...existingRawMessages,
    {
      ...textMessage('20002', 1783840155, 'new message'),
      platformMessageId: 'message-5',
      replyToMessageId: 'message-4',
    },
  ]
  const scopedMessages = existingRawMessages.map((message) => ({
    ...message,
    senderPlatformId: message.senderPlatformId === '20002' ? 'uid-peer' : 'uid-owner',
    platformMessageId: `__chatlab_message_scope__0__${encodeURIComponent(message.platformMessageId!)}`,
  }))
  const candidateMembers = [
    { platformId: 'uid-owner', accountName: 'Owner' },
    { platformId: 'uid-peer', accountName: 'Peer' },
  ]

  seedSession(path.join(tempDir, 'merged.db'), meta, candidateMembers, scopedMessages)
  const sourcePath = path.join(tempDir, 'source.jsonl')
  writeChatLabJsonl(sourcePath, meta, members, rawMessages)

  const result = await autoImportFile(sourcePath, {
    ...createDeps(tempDir, ['merged']),
    sessionExists: (sessionId) => sessionId === 'merged',
    createSession: async () => {
      throw new Error('must not create a second session')
    },
    appendSession: (sessionId, filePath, _formatOptions, onProgress, context) =>
      incrementalImport(
        sessionId,
        filePath,
        {
          openDatabase: (_targetSessionId, readonly = false) =>
            openBetterSqliteDatabase(path.join(tempDir, 'merged.db'), { readonly, nativeBinding }),
          onProgress: onProgress ?? (() => {}),
        },
        {
          platformMessageIdScope: context?.platformMessageIdScope,
          senderPlatformIdMappings: context?.senderPlatformIdMappings,
        }
      ),
  })

  assert.equal(result.success, true)
  assert.equal(result.importMode, 'incremental')
  assert.equal(result.matchedBy, 'trailing-messages')
  assert.equal(result.newMessageCount, 1)
  assert.equal(result.duplicateCount, 5)

  const db = openBetterSqliteDatabase(path.join(tempDir, 'merged.db'), { readonly: true, nativeBinding })
  const rows = db
    .prepare('SELECT platform_message_id, reply_to_message_id FROM message ORDER BY ts, id')
    .all() as Array<{ platform_message_id: string | null; reply_to_message_id: string | null }>
  db.close()

  assert.equal(rows.length, 6)
  assert.deepEqual(rows.at(-1), {
    platform_message_id: '__chatlab_message_scope__0__message-5',
    reply_to_message_id: '__chatlab_message_scope__0__message-4',
  })
})

test('auto import preserves every existing namespace in an already scoped source', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const meta: SourceMeta = { name: 'Merged private chats', platform: 'qq', type: 'private' }
  const sourceMembers = [
    { platformId: '10001', accountName: 'Owner' },
    { platformId: '20002', accountName: 'Peer' },
  ]
  const candidateMembers = [
    { platformId: 'uid-owner', accountName: 'Owner' },
    { platformId: 'uid-peer', accountName: 'Peer' },
  ]
  const existingMessages = Array.from({ length: 5 }, (_, index) => ({
    ...textMessage(index % 2 === 0 ? 'uid-peer' : 'uid-owner', 1783840170 + index, `message ${index}`),
    platformMessageId: `__chatlab_message_scope__0__message-${index}`,
  }))
  const sourceMessages = [
    ...existingMessages.map((message, index) => ({
      ...message,
      senderPlatformId: index % 2 === 0 ? '20002' : '10001',
    })),
    {
      ...textMessage('20002', 1783840175, 'second namespace'),
      platformMessageId: '__chatlab_message_scope__1__message-5',
      replyToMessageId: '__chatlab_message_scope__1__message-4',
    },
  ]

  seedSession(path.join(tempDir, 'merged.db'), meta, candidateMembers, existingMessages)
  const sourcePath = path.join(tempDir, 'source.jsonl')
  writeChatLabJsonl(sourcePath, meta, sourceMembers, sourceMessages)

  const result = await autoImportFile(sourcePath, {
    ...createDeps(tempDir, ['merged']),
    sessionExists: (sessionId) => sessionId === 'merged',
    createSession: async () => {
      throw new Error('must not create a second session')
    },
    appendSession: (sessionId, filePath, _formatOptions, onProgress, context) =>
      incrementalImport(
        sessionId,
        filePath,
        {
          openDatabase: (_targetSessionId, readonly = false) =>
            openBetterSqliteDatabase(path.join(tempDir, 'merged.db'), { readonly, nativeBinding }),
          onProgress: onProgress ?? (() => {}),
        },
        {
          platformMessageIdScope: context?.platformMessageIdScope,
          senderPlatformIdMappings: context?.senderPlatformIdMappings,
        }
      ),
  })

  assert.equal(result.success, true)
  assert.equal(result.importMode, 'incremental')
  assert.equal(result.newMessageCount, 1)
  assert.equal(result.duplicateCount, 5)

  const db = openBetterSqliteDatabase(path.join(tempDir, 'merged.db'), { readonly: true, nativeBinding })
  const rows = db
    .prepare('SELECT platform_message_id, reply_to_message_id FROM message ORDER BY ts, id')
    .all() as Array<{ platform_message_id: string | null; reply_to_message_id: string | null }>
  db.close()
  assert.deepEqual(rows.at(-1), {
    platform_message_id: '__chatlab_message_scope__1__message-5',
    reply_to_message_id: '__chatlab_message_scope__1__message-4',
  })
})

test('does not normalize an already scoped source into a different candidate scope', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const meta: SourceMeta = { name: 'Merged private chats', platform: 'qq', type: 'private' }
  const candidateMembers = [
    { platformId: 'uid-owner', accountName: 'Owner' },
    { platformId: 'uid-peer', accountName: 'Peer' },
  ]
  const sourceMembers = [
    { platformId: '10001', accountName: 'Owner' },
    { platformId: '20002', accountName: 'Peer' },
  ]
  const candidateMessages = Array.from({ length: 5 }, (_, index) => ({
    ...textMessage(index % 2 === 0 ? 'uid-peer' : 'uid-owner', 1783840180 + index, `message ${index}`),
    platformMessageId: `__chatlab_message_scope__0__message-${index}`,
  }))
  const sourceMessages = candidateMessages.map((message, index) => ({
    ...message,
    senderPlatformId: index % 2 === 0 ? '20002' : '10001',
    platformMessageId: message.platformMessageId?.replace(
      '__chatlab_message_scope__0__',
      '__chatlab_message_scope__1__'
    ),
  }))

  seedSession(path.join(tempDir, 'merged.db'), meta, candidateMembers, candidateMessages)
  const sourcePath = path.join(tempDir, 'source.jsonl')
  writeChatLabJsonl(sourcePath, meta, sourceMembers, sourceMessages)

  assert.deepEqual(await resolveAutoImportTarget(sourcePath, createDeps(tempDir, ['merged'])), {
    action: 'create',
    reason: 'no-match',
  })
})

test('prefers a unique stable identity over a different trailing-message candidate', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const sourceMeta: SourceMeta = {
    name: 'Private chat',
    platform: 'line',
    type: 'private',
    ownerId: 'owner',
  }
  const sourceMembers = [
    { platformId: 'owner', accountName: 'Owner' },
    { platformId: 'peer', accountName: 'Peer' },
  ]
  const messages = [
    textMessage('owner', 1783840161, 'one'),
    textMessage('peer', 1783840162, 'two'),
    textMessage('owner', 1783840163, 'three'),
    textMessage('peer', 1783840164, 'four'),
    textMessage('owner', 1783840165, 'five'),
  ]

  seedSession(path.join(tempDir, 'stable.db'), sourceMeta, sourceMembers, [textMessage('peer', 1, 'old')])
  seedSession(path.join(tempDir, 'trailing.db'), { ...sourceMeta, ownerId: 'different-owner' }, sourceMembers, messages)
  const sourcePath = path.join(tempDir, 'source.jsonl')
  writeChatLabJsonl(sourcePath, sourceMeta, sourceMembers, messages)

  assert.deepEqual(await resolveAutoImportTarget(sourcePath, createDeps(tempDir, ['stable', 'trailing'])), {
    action: 'incremental',
    sessionId: 'stable',
    matchedBy: 'stable-id',
  })
})

test('uses a unique trailing overlap to disambiguate multiple stable matches', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const meta: SourceMeta = {
    name: 'Renamed group',
    platform: 'qq',
    type: 'group',
    groupId: 'group-42',
  }
  const members = [{ platformId: 'member', accountName: 'Member' }]
  const messages = [
    textMessage('member', 1783840171, 'one'),
    textMessage('member', 1783840172, 'two'),
    textMessage('member', 1783840173, 'three'),
    textMessage('member', 1783840174, 'four'),
    textMessage('member', 1783840175, 'five'),
  ]

  seedSession(path.join(tempDir, 'matching-tail.db'), meta, members, messages)
  seedSession(path.join(tempDir, 'different-tail.db'), meta, members, [
    textMessage('member', 1, 'other one'),
    textMessage('member', 2, 'other two'),
    textMessage('member', 3, 'other three'),
    textMessage('member', 4, 'other four'),
    textMessage('member', 5, 'other five'),
  ])
  const sourcePath = path.join(tempDir, 'source.jsonl')
  writeChatLabJsonl(sourcePath, meta, members, messages)

  assert.deepEqual(
    await resolveAutoImportTarget(sourcePath, createDeps(tempDir, ['matching-tail', 'different-tail'])),
    {
      action: 'incremental',
      sessionId: 'matching-tail',
      matchedBy: 'trailing-messages',
    }
  )
})

test('uses a validated ChatLab source session id to disambiguate stable matches', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const meta: SourceMeta = {
    name: 'Private chat',
    platform: 'wechat',
    type: 'private',
    ownerId: 'owner',
  }
  const members = [
    { platformId: 'owner', accountName: 'Owner' },
    { platformId: 'peer', accountName: 'Peer' },
  ]
  const messages = [textMessage('peer', 1783860000, 'hello')]

  seedSession(path.join(tempDir, 'source-session.db'), meta, members, messages)
  seedSession(path.join(tempDir, 'duplicate-session.db'), meta, members, messages)
  writeChatLabJsonl(path.join(tempDir, 'source.jsonl'), meta, members, messages, 'source-session')

  assert.deepEqual(
    await resolveAutoImportTarget(
      path.join(tempDir, 'source.jsonl'),
      createDeps(tempDir, ['source-session', 'duplicate-session'])
    ),
    {
      action: 'incremental',
      sessionId: 'source-session',
      matchedBy: 'source-session-id',
    }
  )
})

test('does not trust a ChatLab source session id that fails identity validation', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const sourceMeta: SourceMeta = {
    name: 'Private chat',
    platform: 'wechat',
    type: 'private',
    ownerId: 'owner',
  }
  const sourceMembers = [
    { platformId: 'owner', accountName: 'Owner' },
    { platformId: 'peer', accountName: 'Peer' },
  ]
  const messages = [textMessage('peer', 1783860000, 'hello')]

  seedSession(path.join(tempDir, 'matching-a.db'), sourceMeta, sourceMembers, messages)
  seedSession(path.join(tempDir, 'matching-b.db'), sourceMeta, sourceMembers, messages)
  seedSession(
    path.join(tempDir, 'unrelated.db'),
    { ...sourceMeta, ownerId: 'different-owner' },
    [
      { platformId: 'different-owner', accountName: 'Other owner' },
      { platformId: 'different-peer', accountName: 'Other peer' },
    ],
    [textMessage('different-peer', 1783860000, 'hello')]
  )
  writeChatLabJsonl(path.join(tempDir, 'source.jsonl'), sourceMeta, sourceMembers, messages, 'unrelated')

  assert.deepEqual(
    await resolveAutoImportTarget(
      path.join(tempDir, 'source.jsonl'),
      createDeps(tempDir, ['matching-a', 'matching-b', 'unrelated'])
    ),
    { action: 'create', reason: 'ambiguous' }
  )
})

test('matches a unique session when its last five business messages appear consecutively in the source', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const meta: SourceMeta = { name: 'WhatsApp chat', platform: 'whatsapp', type: 'private' }
  const members = [
    { platformId: 'Alice', accountName: 'Alice' },
    { platformId: 'Bob', accountName: 'Bob' },
  ]
  const trailingMessages = [
    textMessage('Alice', 1783840201, 'one'),
    textMessage('Bob', 1783840202, 'two'),
    textMessage('Alice', 1783840203, 'three'),
    textMessage('Bob', 1783840204, 'four'),
    textMessage('Alice', 1783840205, 'five'),
  ]
  seedSession(path.join(tempDir, 'text-existing.db'), meta, members, trailingMessages)
  writeChatLabJsonl(path.join(tempDir, 'text-source.jsonl'), meta, members, [
    textMessage('Bob', 1783840200, 'before'),
    ...trailingMessages,
    textMessage('Bob', 1783840206, 'after'),
  ])

  assert.deepEqual(
    await resolveAutoImportTarget(path.join(tempDir, 'text-source.jsonl'), createDeps(tempDir, ['text-existing'])),
    {
      action: 'incremental',
      sessionId: 'text-existing',
      matchedBy: 'trailing-messages',
    }
  )
})

test('does not match fewer than five or non-consecutive business messages', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const meta: SourceMeta = { name: 'LINE chat', platform: 'line', type: 'private' }
  const members = [
    { platformId: 'Alice', accountName: 'Alice' },
    { platformId: 'Bob', accountName: 'Bob' },
  ]
  const trailingMessages = [
    textMessage('Alice', 1783840301, 'one'),
    textMessage('Bob', 1783840302, 'two'),
    textMessage('Alice', 1783840303, 'three'),
    textMessage('Bob', 1783840304, 'four'),
    textMessage('Alice', 1783840305, 'five'),
  ]
  seedSession(path.join(tempDir, 'existing.db'), meta, members, trailingMessages)

  const fourOnlyPath = path.join(tempDir, 'four-only.jsonl')
  writeChatLabJsonl(fourOnlyPath, meta, members, trailingMessages.slice(0, 4))
  assert.deepEqual(await resolveAutoImportTarget(fourOnlyPath, createDeps(tempDir, ['existing'])), {
    action: 'create',
    reason: 'no-match',
  })

  const interruptedPath = path.join(tempDir, 'interrupted.jsonl')
  writeChatLabJsonl(interruptedPath, meta, members, [
    ...trailingMessages.slice(0, 2),
    textMessage('Bob', 1783840302.5, 'different business message'),
    ...trailingMessages.slice(2),
  ])
  assert.deepEqual(await resolveAutoImportTarget(interruptedPath, createDeps(tempDir, ['existing'])), {
    action: 'create',
    reason: 'no-match',
  })
})

test('ignores system and recall messages when matching five consecutive business messages', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const meta: SourceMeta = { name: 'LINE chat', platform: 'line', type: 'private' }
  const members = [
    { platformId: 'Alice', accountName: 'Alice' },
    { platformId: 'system', accountName: 'System' },
  ]
  const businessMessages = [
    textMessage('Alice', 1783840401, 'one'),
    textMessage('Alice', 1783840402, 'two'),
    textMessage('Alice', 1783840403, 'three'),
    textMessage('Alice', 1783840404, 'four'),
    textMessage('Alice', 1783840405, 'five'),
  ]
  seedSession(path.join(tempDir, 'existing.db'), meta, members, [
    businessMessages[0],
    textMessage('system', 1783840401.5, 'joined', MessageType.SYSTEM),
    ...businessMessages.slice(1),
    textMessage('system', 1783840406, 'recalled', MessageType.RECALL),
  ])
  const sourcePath = path.join(tempDir, 'source.jsonl')
  writeChatLabJsonl(sourcePath, meta, members, [
    businessMessages[0],
    businessMessages[1],
    textMessage('system', 1783840402.5, 'notification changed', MessageType.SYSTEM),
    ...businessMessages.slice(2),
  ])

  assert.deepEqual(await resolveAutoImportTarget(sourcePath, createDeps(tempDir, ['existing'])), {
    action: 'incremental',
    sessionId: 'existing',
    matchedBy: 'trailing-messages',
  })
})

test('creates a new session when trailing-message matching is ambiguous', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const meta: SourceMeta = { name: 'WhatsApp chat', platform: 'whatsapp', type: 'private' }
  const members = [{ platformId: 'Alice', accountName: 'Alice' }]
  const messages = [
    textMessage('Alice', 1783840501, 'one'),
    textMessage('Alice', 1783840502, 'two'),
    textMessage('Alice', 1783840503, 'three'),
    textMessage('Alice', 1783840504, 'four'),
    textMessage('Alice', 1783840505, 'five'),
  ]
  seedSession(path.join(tempDir, 'first.db'), meta, members, messages)
  seedSession(path.join(tempDir, 'second.db'), meta, members, messages)
  const sourcePath = path.join(tempDir, 'source.jsonl')
  writeChatLabJsonl(sourcePath, meta, members, messages)

  assert.deepEqual(await resolveAutoImportTarget(sourcePath, createDeps(tempDir, ['first', 'second'])), {
    action: 'create',
    reason: 'ambiguous',
  })
})

test('does not match a candidate with fewer than five business messages', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const meta: SourceMeta = { name: 'Short chat', platform: 'line', type: 'private' }
  const members = [{ platformId: 'Alice', accountName: 'Alice' }]
  const candidateMessages = [
    textMessage('Alice', 1783840601, 'one'),
    textMessage('Alice', 1783840602, 'two'),
    textMessage('Alice', 1783840603, 'three'),
    textMessage('Alice', 1783840604, 'four'),
  ]
  seedSession(path.join(tempDir, 'short.db'), meta, members, candidateMessages)
  const sourcePath = path.join(tempDir, 'source.jsonl')
  writeChatLabJsonl(sourcePath, meta, members, [...candidateMessages, textMessage('Alice', 1783840605, 'five')])

  assert.deepEqual(await resolveAutoImportTarget(sourcePath, createDeps(tempDir, ['short'])), {
    action: 'create',
    reason: 'no-match',
  })
})

test('ignores non-chat databases while inspecting Desktop-style candidates', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const meta: SourceMeta = { name: 'LINE chat', platform: 'line', type: 'private' }
  const members = [{ platformId: 'Alice', accountName: 'Alice' }]
  const messages = [
    textMessage('Alice', 1783840701, 'one'),
    textMessage('Alice', 1783840702, 'two'),
    textMessage('Alice', 1783840703, 'three'),
    textMessage('Alice', 1783840704, 'four'),
    textMessage('Alice', 1783840705, 'five'),
  ]
  seedSession(path.join(tempDir, 'existing.db'), meta, members, messages)
  const unrelatedDb = openBetterSqliteDatabase(path.join(tempDir, 'unrelated.db'), { nativeBinding })
  unrelatedDb.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)')
  unrelatedDb.close()

  const sourcePath = path.join(tempDir, 'source.jsonl')
  writeChatLabJsonl(sourcePath, meta, members, messages)

  assert.deepEqual(await resolveAutoImportTarget(sourcePath, createDeps(tempDir, ['unrelated', 'existing'])), {
    action: 'incremental',
    sessionId: 'existing',
    matchedBy: 'trailing-messages',
  })
})

test('reports the candidate session id when a database cannot be inspected', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const sourcePath = path.join(tempDir, 'source.jsonl')
  writeChatLabJsonl(
    sourcePath,
    { name: 'LINE chat', platform: 'line', type: 'private' },
    [{ platformId: 'Alice', accountName: 'Alice' }],
    [textMessage('Alice', 1783840801, 'hello')]
  )

  await assert.rejects(
    resolveAutoImportTarget(sourcePath, {
      listSessionIds: () => ['broken-session'],
      openReadonly: () => {
        throw new Error('database disk image is malformed')
      },
    }),
    /broken-session.*database disk image is malformed/
  )
})
