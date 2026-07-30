import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { CHAT_DB_TABLES } from '@openchatlab/core'
import { isNativeFormatAvailable } from '@openchatlab/parser'
import { BetterSqliteAdapter } from '../better-sqlite3-adapter'
import { computeAndSetOverviewCache } from '../cache/session-cache'
import { TEMP_DB_SCHEMA } from '../merger/temp-db'
import {
  analyzeNewImport,
  streamingImport,
  streamParseFileInfo,
  type ImportLogger,
  type StreamImportDeps,
} from './streaming-importer'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

function makeTempDir(): string {
  const baseDir = process.env.CHATLAB_TEST_TMPDIR ?? (fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir())
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-streaming-import-'))
}

function createImportDeps(dbPath: string): StreamImportDeps {
  return {
    openDatabase() {
      const db = new Database(dbPath, { nativeBinding })
      db.exec(CHAT_DB_TABLES)
      return new BetterSqliteAdapter(db)
    },
    deleteDatabase() {
      for (const suffix of ['', '-wal', '-shm']) {
        try {
          fs.unlinkSync(dbPath + suffix)
        } catch {
          /* ignore */
        }
      }
    },
    onProgress() {
      /* noop for focused importer tests */
    },
  }
}

function createCollectingLogger(messages: string[]): ImportLogger {
  return {
    info(message) {
      messages.push(message)
    },
    error(message) {
      messages.push(message)
    },
    perf() {
      /* noop for focused importer tests */
    },
    perfDetail() {
      /* noop for focused importer tests */
    },
    summary() {
      /* noop for focused importer tests */
    },
    reset() {
      /* noop for focused importer tests */
    },
    init() {
      /* noop for focused importer tests */
    },
    getCurrentLogFile() {
      return null
    },
  }
}

function writeChunkedShuakamiQqExport(root: string): string {
  const chunksDir = path.join(root, 'chunks')
  fs.mkdirSync(chunksDir, { recursive: true })

  const avatar = 'data:image/png;base64,AAAA'
  fs.writeFileSync(path.join(root, 'avatars.json'), JSON.stringify({ '10001': avatar }, null, 2), 'utf-8')

  const message = {
    id: 'msg-1',
    seq: '1',
    timestamp: 1711468800000,
    time: '2024-03-26T16:00:00.000Z',
    sender: {
      uid: 'u_10001',
      uin: '10001',
      name: 'Alice',
      nickname: 'Alice',
      groupCard: 'Alice Card',
    },
    type: 'text',
    content: { text: 'hello', elements: [], resources: [], mentions: [] },
    recalled: false,
    system: false,
  }
  fs.writeFileSync(path.join(chunksDir, 'chunk_0001.jsonl'), `${JSON.stringify(message)}\n`, 'utf-8')

  const manifest = {
    metadata: {
      name: 'shuakami/qq-chat-exporter',
      version: '5.5.0',
      exportTime: '2024-03-26T16:00:00.000Z',
      format: 'chunked-jsonl',
    },
    chatInfo: {
      name: 'Avatar Test Group',
      type: 'group',
      selfUid: 'u_10001',
      selfUin: '10001',
      selfName: 'Alice',
    },
    statistics: {
      totalMessages: 1,
      timeRange: {
        start: '2024-03-26T16:00:00.000Z',
        end: '2024-03-26T16:00:00.000Z',
        durationDays: 1,
      },
      messageTypes: { text: 1 },
      senders: [{ uid: 'u_10001', name: 'Alice', messageCount: 1, percentage: 100 }],
    },
    chunked: {
      format: 'jsonl',
      chunksDir: 'chunks',
      chunkFileExt: '.jsonl',
      maxMessagesPerChunk: 1000,
      maxBytesPerChunk: 1024 * 1024,
      chunks: [
        {
          index: 1,
          fileName: 'chunk_0001.jsonl',
          relativePath: 'chunks/chunk_0001.jsonl',
          count: 1,
          start: '2024-03-26T16:00:00.000Z',
          end: '2024-03-26T16:00:00.000Z',
        },
      ],
    },
    avatars: { file: 'avatars.json', count: 1 },
  }
  const manifestPath = path.join(root, 'manifest.json')
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
  return manifestPath
}

function writeSingleFileShuakamiQqExport(root: string): string {
  const filePath = path.join(root, 'shuakami-qq-v4.json')
  const firstMessage = {
    messageId: 'qq-message-1',
    timestamp: '2026-07-10T12:00:00.000Z',
    sender: { uin: '10001', uid: 'u_10001', name: 'Alice' },
    messageType: 2,
    content: { text: 'native searchable message' },
    rawMessage: { sendNickName: 'Alice QQ', sendMemberName: 'Alice Card' },
  }
  fs.writeFileSync(
    filePath,
    JSON.stringify({
      metadata: { name: 'QQChatExporter V6', version: '6.0.3' },
      chatInfo: { name: 'Native Import Group', type: 'group', avatar: 'data:image/png;base64,GROUP' },
      statistics: {
        senders: [
          { uid: 'u_10001', name: 'Alice' },
          { uid: 'u_10002', name: 'Bob' },
          { uid: 'u_10003', name: 'Carol' },
        ],
      },
      messages: [
        firstMessage,
        { ...firstMessage },
        {
          messageId: 'qq-message-2',
          timestamp: '2026-07-10T12:01:00.000Z',
          sender: { uin: '10002', uid: 'u_10002', name: 'Bob' },
          messageType: 9,
          content: { text: 'reply content', reply: { referencedMessageId: 'qq-message-1' } },
          rawMessage: { sendNickName: 'Bob QQ' },
        },
      ],
      avatars: { '10001': 'data:image/jpeg;base64,ALICE' },
    }),
    'utf-8'
  )
  return filePath
}

function writeLargeSingleFileShuakamiQqExport(root: string): string {
  const filePath = path.join(root, 'shuakami-qq-v4-large.json')
  const descriptor = fs.openSync(filePath, 'w')
  try {
    fs.writeSync(
      descriptor,
      JSON.stringify({
        metadata: { name: 'QQChatExporter V6', version: '6.0.3' },
        chatInfo: { name: 'Native Preprocess Gate', type: 'group' },
        statistics: { senders: [{ uid: 'u_10001' }] },
        messages: [],
      }).slice(0, -2) +
        '{"messageId":"large-message","timestamp":"2026-07-10T12:00:00.000Z",' +
        '"sender":{"uin":"10001","name":"Alice"},"content":{"text":"large native message","html":"'
    )
    const oneMegabyte = 'H'.repeat(1024 * 1024)
    for (let index = 0; index < 50; index++) fs.writeSync(descriptor, oneMegabyte)
    fs.writeSync(descriptor, '"}}],"avatars":{}}')
  } finally {
    fs.closeSync(descriptor)
  }
  return filePath
}

function writeDuplicateChatLabExport(root: string): string {
  const filePath = path.join(root, 'duplicate-chat.json')
  fs.writeFileSync(
    filePath,
    JSON.stringify({
      chatlab: { version: '0.0.2', exportedAt: 1711468800 },
      meta: { name: 'Duplicate Test', platform: 'instagram', type: 'private', ownerId: 'owner' },
      members: [
        { platformId: 'owner', accountName: 'Owner' },
        { platformId: 'friend', accountName: 'Friend' },
      ],
      messages: [
        { sender: 'friend', accountName: 'Friend', timestamp: 1711468800, type: 0, content: 'same message' },
        { sender: 'friend', accountName: 'Friend', timestamp: 1711468800, type: 0, content: 'same message' },
        { sender: 'friend', accountName: 'Friend', timestamp: 1711468800, type: 1, content: 'same message' },
        {
          sender: 'owner',
          accountName: 'Owner',
          timestamp: 1711468801,
          type: 0,
          content: 'message with id',
          platformMessageId: 'platform-1',
        },
        {
          sender: 'owner',
          accountName: 'Owner',
          timestamp: 1711468801,
          type: 0,
          content: 'message with id',
          platformMessageId: 'platform-1',
        },
      ],
    }),
    'utf-8'
  )
  return filePath
}

function writeSystemChatLabExport(root: string): string {
  const filePath = path.join(root, 'system-chat.json')
  fs.writeFileSync(
    filePath,
    JSON.stringify({
      chatlab: { version: '0.0.2', exportedAt: 1_711_468_800 },
      meta: { name: 'System Test', platform: 'custom', type: 'group', ownerId: 'alice' },
      members: [{ platformId: 'alice', accountName: 'Alice' }],
      messages: [
        { sender: 'alice', accountName: 'Alice', timestamp: 1_711_468_800, type: 0, content: 'hello' },
        {
          sender: 'SYSTEM',
          accountName: 'System',
          timestamp: 1_711_468_801,
          type: 80,
          content: 'Bob joined the group',
        },
      ],
    }),
    'utf8'
  )
  return filePath
}

function writeWhatsAppSystemParticipantExport(root: string): string {
  const filePath = path.join(root, 'WhatsApp-SYSTEM.txt')
  fs.writeFileSync(filePath, '2024/01/02 03:04 - SYSTEM: hello\n', 'utf8')
  return filePath
}

function writeLargeChatLabJsonl(root: string): string {
  const filePath = path.join(root, 'large-chat.jsonl')
  const lines = [
    JSON.stringify({
      _type: 'header',
      chatlab: { version: '0.0.2', exportedAt: 1711468800 },
      meta: { name: 'Large JSONL Test', platform: 'qq', type: 'group' },
    }),
    JSON.stringify({
      _type: 'member',
      platformId: 'member-1',
      accountName: 'Alice',
      avatar: 'data:image/png;base64,AAAA',
    }),
  ]

  for (let index = 0; index < 5001; index++) {
    lines.push(
      JSON.stringify({
        _type: 'message',
        sender: 'member-1',
        accountName: 'Alice',
        timestamp: 1711468800 + index,
        type: 0,
        content: `message-${index}`,
      })
    )
  }

  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf-8')
  return filePath
}

test('streamParseFileInfo preserves member metadata from a batched ChatLab JSONL import', async (t) => {
  const root = makeTempDir()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const filePath = writeLargeChatLabJsonl(root)
  const tempDbPath = path.join(root, 'merge-preview.db')

  await streamParseFileInfo(filePath, {
    createTempDatabase() {
      const db = new Database(tempDbPath, { nativeBinding })
      db.exec(TEMP_DB_SCHEMA)
      return { db: new BetterSqliteAdapter(db), tempDbPath }
    },
    onProgress() {
      /* noop for this focused merge-preview test */
    },
  })

  const db = new Database(tempDbPath, { readonly: true, nativeBinding })
  const row = db.prepare('SELECT avatar FROM member WHERE platform_id = ?').get('member-1') as
    | { avatar: string | null }
    | undefined
  db.close()

  assert.equal(row?.avatar, 'data:image/png;base64,AAAA')
})

test('streamingImport updates avatars for members first created from message batches', async () => {
  const root = makeTempDir()
  const manifestPath = writeChunkedShuakamiQqExport(root)
  const dbPath = path.join(root, 'avatar-test.db')

  const result = await streamingImport(manifestPath, createImportDeps(dbPath), undefined, 'avatar-test')

  assert.equal(result.success, true)

  const db = new Database(dbPath, { nativeBinding })
  const row = db.prepare('SELECT platform_id, avatar FROM member WHERE platform_id = ?').get('10001') as
    | { platform_id: string; avatar: string | null }
    | undefined
  db.close()

  assert.equal(row?.platform_id, '10001')
  assert.equal(row?.avatar, 'data:image/png;base64,AAAA')
})

test(
  'streamingImport persists shuakami/qq-chat-exporter V4 native-first output with deduplication, reply and FTS',
  {
    skip: !isNativeFormatAvailable('shuakami-qq-exporter') && 'native shuakami/qq-chat-exporter kernel not built',
  },
  async (t) => {
    const root = makeTempDir()
    t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    const filePath = writeSingleFileShuakamiQqExport(root)
    const dbPath = path.join(root, 'shuakami-qq-native-import.db')
    const logMessages: string[] = []
    const deps = createImportDeps(dbPath)
    deps.logger = createCollectingLogger(logMessages)

    const result = await streamingImport(filePath, deps, undefined, 'shuakami-qq-native-import')

    assert.equal(result.success, true)
    assert.equal(result.platform, 'qq')
    assert.equal(result.diagnostics?.messagesReceived, 3)
    assert.equal(result.diagnostics?.messagesWritten, 2)
    assert.equal(result.diagnostics?.duplicateCount, 1)
    assert.ok(
      logMessages.some((message) =>
        message.includes('[NativeParser] Parsing shuakami/qq-chat-exporter with Rust kernel')
      )
    )
    assert.equal(
      logMessages.some((message) => message.includes('falling back to TS parser')),
      false
    )

    const db = new Database(dbPath, { readonly: true, nativeBinding })
    const meta = db.prepare('SELECT name, platform, type, group_avatar FROM meta LIMIT 1').get() as {
      name: string
      platform: string
      type: string
      group_avatar: string | null
    }
    const counts = db
      .prepare('SELECT (SELECT COUNT(*) FROM member) AS members, (SELECT COUNT(*) FROM message) AS messages')
      .get() as { members: number; messages: number }
    const reply = db
      .prepare('SELECT reply_to_message_id FROM message WHERE platform_message_id = ?')
      .get('qq-message-2') as {
      reply_to_message_id: string | null
    }
    const fts = db.prepare("SELECT COUNT(*) AS count FROM message_fts WHERE content MATCH 'searchable'").get() as {
      count: number
    }
    db.close()

    assert.deepEqual(meta, {
      name: 'Native Import Group',
      platform: 'qq',
      type: 'group',
      group_avatar: 'data:image/png;base64,GROUP',
    })
    assert.deepEqual(counts, { members: 2, messages: 2 })
    assert.equal(reply.reply_to_message_id, 'qq-message-1')
    assert.equal(fts.count, 1)
  }
)

test(
  'streamingImport skips the >50MB shuakami/qq-chat-exporter slim preprocessor when the current binary supports the native kernel',
  {
    skip: !isNativeFormatAvailable('shuakami-qq-exporter') && 'native shuakami/qq-chat-exporter kernel not built',
  },
  async (t) => {
    const root = makeTempDir()
    t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    const filePath = writeLargeSingleFileShuakamiQqExport(root)
    const dbPath = path.join(root, 'shuakami-qq-native-large.db')
    const logMessages: string[] = []
    const deps = createImportDeps(dbPath)
    deps.logger = createCollectingLogger(logMessages)

    const result = await streamingImport(filePath, deps, undefined, 'shuakami-qq-native-large')

    assert.equal(result.success, true)
    assert.equal(result.diagnostics?.messagesWritten, 1)
    assert.ok(
      logMessages.some(
        (message) =>
          message.includes('Kernel shuakami-qq-exporter is available') &&
          message.includes('skipping large-file preprocessing')
      )
    )
    assert.equal(
      logMessages.some((message) => message.includes('Preprocessing done')),
      false
    )
    assert.ok(
      logMessages.some((message) =>
        message.includes('[NativeParser] Parsing shuakami/qq-chat-exporter with Rust kernel')
      )
    )
    assert.equal(
      logMessages.some((message) => message.includes('falling back to TS parser')),
      false
    )
  }
)

test('streamingImport cleans a generated shuakami/qq-chat-exporter slim file when database setup fails', async (t) => {
  const root = makeTempDir()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const filePath = writeLargeSingleFileShuakamiQqExport(root)
  const logMessages: string[] = []
  const saved = process.env.CHATLAB_DISABLE_NATIVE_PERF
  process.env.CHATLAB_DISABLE_NATIVE_PERF = '1'

  try {
    await assert.rejects(
      streamingImport(
        filePath,
        {
          openDatabase() {
            throw new Error('database setup failed for test')
          },
          deleteDatabase() {
            /* no database was created */
          },
          onProgress() {
            /* noop for focused cleanup assertion */
          },
          logger: createCollectingLogger(logMessages),
        },
        undefined,
        'shuakami-qq-preprocess-setup-failure'
      ),
      /database setup failed for test/
    )

    const tempLog = logMessages.find((message) => message.startsWith('Preprocessing done, temp file: '))
    assert.ok(tempLog)
    const tempFilePath = tempLog.slice('Preprocessing done, temp file: '.length)
    assert.equal(fs.existsSync(tempFilePath), false)
  } finally {
    if (saved === undefined) delete process.env.CHATLAB_DISABLE_NATIVE_PERF
    else process.env.CHATLAB_DISABLE_NATIVE_PERF = saved
  }
})

test('streamingImport applies incremental-equivalent deduplication on first import', async (t) => {
  const root = makeTempDir()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const filePath = writeDuplicateChatLabExport(root)
  const dbPath = path.join(root, 'duplicate-test.db')

  const analysis = await analyzeNewImport(filePath, () => {})
  assert.equal(analysis.totalMessages, 5)
  assert.equal(analysis.newMessageCount, 3)
  assert.equal(analysis.duplicateCount, 2)

  const result = await streamingImport(filePath, createImportDeps(dbPath), undefined, 'duplicate-test')

  assert.equal(result.success, true)
  assert.equal(result.diagnostics?.messagesReceived, 5)
  assert.equal(result.diagnostics?.messagesWritten, 3)
  assert.equal(result.diagnostics?.duplicateCount, 2)

  const db = new Database(dbPath, { readonly: true, nativeBinding })
  const row = db.prepare('SELECT COUNT(*) AS count FROM message').get() as { count: number }
  db.close()
  assert.equal(row.count, 3)
})

test('streamingImport canonicalizes reserved SYSTEM senders and excludes them from overview counts', async (t) => {
  const root = makeTempDir()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const filePath = writeSystemChatLabExport(root)
  const dbPath = path.join(root, 'system-test.db')

  const result = await streamingImport(filePath, createImportDeps(dbPath), undefined, 'system-test')

  assert.equal(result.success, true)

  const rawDb = new Database(dbPath, { nativeBinding })
  const db = new BetterSqliteAdapter(rawDb)
  const systemMember = db
    .prepare('SELECT account_name, group_nickname FROM member WHERE platform_id = ?')
    .get('SYSTEM') as { account_name: string | null; group_nickname: string | null } | undefined
  const systemMessage = db
    .prepare(
      `SELECT msg.sender_account_name, msg.sender_group_nickname
       FROM message msg
       JOIN member m ON m.id = msg.sender_id
       WHERE m.platform_id = ?`
    )
    .get('SYSTEM') as { sender_account_name: string | null; sender_group_nickname: string | null } | undefined
  const overview = computeAndSetOverviewCache(db, 'system-test', path.join(root, 'cache'))
  rawDb.close()

  assert.deepEqual(systemMember, { account_name: '系统消息', group_nickname: '系统消息' })
  assert.deepEqual(systemMessage, { sender_account_name: '系统消息', sender_group_nickname: '系统消息' })
  assert.equal(overview.totalMembers, 1)
  assert.equal(overview.totalMessages, 1)
})

test('streamingImport preserves an ordinary WhatsApp participant named SYSTEM', async (t) => {
  const root = makeTempDir()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const filePath = writeWhatsAppSystemParticipantExport(root)
  const dbPath = path.join(root, 'whatsapp-system-participant.db')

  const result = await streamingImport(filePath, createImportDeps(dbPath), undefined, 'whatsapp-system-participant')

  assert.equal(result.success, true)
  assert.equal(result.platform, 'whatsapp')

  const rawDb = new Database(dbPath, { readonly: true, nativeBinding })
  const member = rawDb
    .prepare('SELECT account_name, group_nickname FROM member WHERE platform_id = ?')
    .get('SYSTEM') as { account_name: string | null; group_nickname: string | null } | undefined
  const message = rawDb
    .prepare(
      `SELECT msg.sender_account_name, msg.sender_group_nickname, msg.type
       FROM message msg
       JOIN member m ON m.id = msg.sender_id
       WHERE m.platform_id = ?`
    )
    .get('SYSTEM') as
    | { sender_account_name: string | null; sender_group_nickname: string | null; type: number }
    | undefined
  rawDb.close()

  assert.deepEqual(member, { account_name: 'SYSTEM', group_nickname: null })
  assert.deepEqual(message, { sender_account_name: 'SYSTEM', sender_group_nickname: null, type: 0 })
})

test('analyzeNewImport honors an explicitly selected parser format', async (t) => {
  const root = makeTempDir()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const detectedPath = writeDuplicateChatLabExport(root)
  const filePath = path.join(root, 'explicit-format.txt')
  fs.renameSync(detectedPath, filePath)

  const analysis = await analyzeNewImport(filePath, () => {}, { formatId: 'chatlab' })

  assert.equal(analysis.error, undefined)
  assert.equal(analysis.totalMessages, 5)
  assert.equal(analysis.newMessageCount, 3)
  assert.equal(analysis.duplicateCount, 2)
})
