import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { CHAT_DB_SCHEMA } from '@openchatlab/core'
import { MessageType, type ParsedMessage } from '@openchatlab/shared-types'
import { openBetterSqliteDatabase } from '../better-sqlite3-adapter'
import { resolveAutoImportTarget, type AutoImportMatcherDeps } from './auto-import-matcher'

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
    `INSERT INTO message (sender_id, sender_account_name, ts, type, content)
     VALUES (?, ?, ?, ?, ?)`
  )
  const memberIds = new Map<string, number>()
  for (const member of members) {
    const result = insertMember.run(member.platformId, member.accountName)
    memberIds.set(member.platformId, Number(result.lastInsertRowid))
  }
  for (const message of messages) {
    const senderId = memberIds.get(message.senderPlatformId)
    assert.ok(senderId, `missing member ${message.senderPlatformId}`)
    insertMessage.run(senderId, message.senderAccountName, message.timestamp, message.type, message.content)
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
