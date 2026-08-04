import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import sqlite3InitModule, { type Database, type Sqlite3Static } from '@sqlite.org/sqlite-wasm'
import type { DatabaseAdapter } from '@openchatlab/core'
import { CHAT_DB_TABLES } from '@openchatlab/core'
import { SqliteWasmDatabaseAdapter } from '../sqlite/adapter'
import type { WorkspaceDatabaseStage } from '../storage/workspace-database'
import type { BrowserParseSource } from './chatlab-parser'
import { BrowserSessionCatalog } from './session-catalog'
import { BrowserSessionRuntime, sessionDatabaseFilename, type WorkspaceDatabasePort } from './session-runtime'

class MemoryWorkspaceDatabase implements WorkspaceDatabasePort {
  private readonly databases = new Map<string, { raw: Database; adapter: SqliteWasmDatabaseAdapter }>()
  readonly deleted: string[] = []
  failOnFilename: string | undefined
  requireWorkspaceLease = false
  workspaceLeaseDepth = 0
  workspaceLeaseEntries = 0
  workspaceLeaseSignal: AbortSignal | undefined

  constructor(private readonly sqlite3: Sqlite3Static) {}

  async withWorkspaceLease<T>(
    operation: () => Promise<T>,
    _onStage?: (stage: WorkspaceDatabaseStage) => void,
    signal?: AbortSignal
  ): Promise<T> {
    const isOutermost = this.workspaceLeaseDepth === 0
    if (isOutermost) this.workspaceLeaseEntries += 1
    this.workspaceLeaseSignal = signal
    this.workspaceLeaseDepth += 1
    try {
      return await operation()
    } finally {
      this.workspaceLeaseDepth -= 1
    }
  }

  async withDatabase<T>(
    filename: string,
    schemaSql: string,
    operation: (db: DatabaseAdapter) => T | Promise<T>
  ): Promise<T> {
    this.assertWorkspaceLease()
    let entry = this.databases.get(filename)
    if (!entry) {
      const raw = new this.sqlite3.oo1.DB(':memory:', 'c')
      entry = { raw, adapter: new SqliteWasmDatabaseAdapter(this.sqlite3, raw) }
      this.databases.set(filename, entry)
    }
    entry.adapter.exec(schemaSql)
    if (this.failOnFilename === filename) throw new Error('simulated database write failure')
    return operation(entry.adapter)
  }

  async deleteDatabase(filename: string): Promise<boolean> {
    this.assertWorkspaceLease()
    const entry = this.databases.get(filename)
    if (!entry) return false
    entry.adapter.close()
    this.databases.delete(filename)
    this.deleted.push(filename)
    return true
  }

  async ensureCapacity(_minimum: number): Promise<number> {
    this.assertWorkspaceLease()
    return 32
  }

  async getDatabaseFilenames(): Promise<string[]> {
    this.assertWorkspaceLease()
    return [...this.databases.keys()]
  }

  getDatabase(filename: string): DatabaseAdapter | undefined {
    return this.databases.get(filename)?.adapter
  }

  dispose(): void {
    for (const entry of this.databases.values()) entry.adapter.close()
    this.databases.clear()
  }

  private assertWorkspaceLease(): void {
    if (this.requireWorkspaceLease && this.workspaceLeaseDepth === 0) {
      throw new Error('workspace database operation ran without a lease')
    }
  }
}

function source(name: string, value: unknown): BrowserParseSource {
  const content = typeof value === 'string' ? value : JSON.stringify(value)
  const blob = new Blob([content])
  return {
    name,
    size: blob.size,
    type: 'application/json',
    text: () => blob.text(),
    arrayBuffer: () => blob.arrayBuffer(),
    slice: (start, end) => blob.slice(start, end),
  }
}

function chat(name: string, sender: string, timestamp: number) {
  return {
    chatlab: { version: '1', exportedAt: timestamp },
    meta: { name, platform: 'wechat', type: 'group', ownerId: sender },
    messages: [{ sender, accountName: sender, timestamp, type: 0, content: `message-${timestamp}` }],
  }
}

function chatJsonl(name: string, sender: string, timestamp: number): string {
  return [
    JSON.stringify({
      _type: 'header',
      chatlab: { version: '1', exportedAt: timestamp },
      meta: { name, platform: 'wechat', type: 'group', ownerId: sender },
    }),
    JSON.stringify({ _type: 'member', platformId: sender, accountName: sender }),
    JSON.stringify({
      _type: 'message',
      sender,
      accountName: sender,
      timestamp,
      type: 0,
      content: `message-${timestamp}`,
    }),
  ].join('\n')
}

function chatWithSystemMessage() {
  return {
    chatlab: { version: '0.0.2', exportedAt: 1 },
    meta: { name: 'System Test', platform: 'custom', type: 'group', ownerId: 'alice' },
    members: [{ platformId: 'alice', accountName: 'Alice' }],
    messages: [
      { sender: 'alice', accountName: 'Alice', timestamp: 1, type: 0, content: 'hello' },
      {
        sender: 'SYSTEM',
        accountName: 'System',
        timestamp: 2,
        type: 80,
        content: 'Bob joined the group',
      },
    ],
  }
}

describe('BrowserSessionRuntime', () => {
  it('parses imports before acquiring the workspace lease and keeps persistence inside it', async () => {
    const sqlite3 = await sqlite3InitModule()
    const database = new MemoryWorkspaceDatabase(sqlite3)
    database.requireWorkspaceLease = true
    const runtime = new BrowserSessionRuntime(database, {
      createSessionId: () => 'lease-scope-session',
      now: () => 100,
    })
    const baseSource = source('lease-scope.jsonl', chatJsonl('Lease Scope', 'alice', 1))
    const abortController = new AbortController()
    let parsedWithoutLease = false
    const fixture: BrowserParseSource = {
      ...baseSource,
      async text() {
        assert.equal(database.workspaceLeaseDepth, 0)
        parsedWithoutLease = true
        return baseSource.text()
      },
    }

    try {
      const result = await runtime.importSource(fixture, {
        formatId: 'chatlab-jsonl',
        signal: abortController.signal,
      })

      assert.equal(result.sessionId, 'lease-scope-session')
      assert.equal(parsedWithoutLease, true)
      assert.equal(database.workspaceLeaseEntries, 1)
      assert.equal(database.workspaceLeaseDepth, 0)
      assert.equal(database.workspaceLeaseSignal, abortController.signal)
    } finally {
      database.dispose()
    }
  })

  it('imports isolated sessions, persists catalog data, renames one, and deletes only its database', async () => {
    const sqlite3 = await sqlite3InitModule()
    const database = new MemoryWorkspaceDatabase(sqlite3)
    const ids = ['session-one', 'session-two']
    const runtime = new BrowserSessionRuntime(database, {
      createSessionId: () => ids.shift() ?? 'unexpected',
      now: () => 100,
    })

    const first = await runtime.importSource(source('one.json', chat('One', 'alice', 1)), { formatId: 'chatlab' })
    const second = await runtime.importSource(source('two.jsonl', chatJsonl('Two', 'bob', 2)), {
      formatId: 'chatlab-jsonl',
    })

    assert.deepEqual(first, {
      sessionId: 'session-one',
      formatId: 'chatlab',
      messageCount: 1,
      memberCount: 1,
      skippedCount: 0,
    })
    assert.equal(second.sessionId, 'session-two')
    assert.equal(second.formatId, 'chatlab-jsonl')
    assert.deepEqual(
      (await runtime.listSessions()).map((item) => ({ id: item.id, name: item.name, messageCount: item.messageCount })),
      [
        { id: 'session-two', name: 'Two', messageCount: 1 },
        { id: 'session-one', name: 'One', messageCount: 1 },
      ]
    )

    assert.equal(await runtime.renameSession('session-one', 'Renamed'), true)
    assert.equal((await runtime.getSession('session-one'))?.name, 'Renamed')
    assert.equal(await runtime.deleteSession('session-one'), true)
    assert.equal(await runtime.getSession('session-one'), null)
    assert.ok(database.getDatabase(sessionDatabaseFilename('session-two')))
    assert.equal(database.getDatabase(sessionDatabaseFilename('session-one')), undefined)
    assert.deepEqual(database.deleted, [sessionDatabaseFilename('session-one')])

    const secondDb = database.getDatabase(sessionDatabaseFilename('session-two'))
    assert.deepEqual(secondDb?.prepare('SELECT content FROM message').get(), { content: 'message-2' })
    database.dispose()
  })

  it('builds the imported session index with the requested gap threshold', async () => {
    const sqlite3 = await sqlite3InitModule()
    const database = new MemoryWorkspaceDatabase(sqlite3)
    const runtime = new BrowserSessionRuntime(database, {
      createSessionId: () => 'threshold-session',
      now: () => 100,
    })

    try {
      await runtime.importSource(source('threshold.json', chat('Threshold', 'alice', 1)), {
        formatId: 'chatlab',
        sessionGapThreshold: 60,
      })

      const db = database.getDatabase(sessionDatabaseFilename('threshold-session'))
      assert.ok(db)
      const meta = db.prepare('SELECT session_gap_threshold FROM meta LIMIT 1').get() as {
        session_gap_threshold: number | null
      }
      assert.equal(meta.session_gap_threshold, 60)
      assert.equal((db.prepare('SELECT COUNT(*) AS count FROM segment').get() as { count: number }).count, 1)
    } finally {
      database.dispose()
    }
  })

  it('canonicalizes reserved SYSTEM senders and excludes them from catalog member counts', async () => {
    const sqlite3 = await sqlite3InitModule()
    const database = new MemoryWorkspaceDatabase(sqlite3)
    const runtime = new BrowserSessionRuntime(database, {
      createSessionId: () => 'system-session',
      now: () => 100,
    })

    const result = await runtime.importSource(source('system.json', chatWithSystemMessage()), {
      formatId: 'chatlab',
    })

    assert.deepEqual(result, {
      sessionId: 'system-session',
      formatId: 'chatlab',
      messageCount: 2,
      memberCount: 1,
      skippedCount: 0,
    })
    assert.equal((await runtime.getSession('system-session'))?.memberCount, 1)

    const sessionDb = database.getDatabase(sessionDatabaseFilename('system-session'))
    assert.deepEqual(
      sessionDb?.prepare('SELECT account_name, group_nickname FROM member WHERE platform_id = ?').get('SYSTEM'),
      { account_name: '系统消息', group_nickname: '系统消息' }
    )
    assert.deepEqual(
      sessionDb
        ?.prepare(
          `SELECT msg.sender_account_name, msg.sender_group_nickname
           FROM message msg
           JOIN member m ON m.id = msg.sender_id
           WHERE m.platform_id = ?`
        )
        .get('SYSTEM'),
      { sender_account_name: '系统消息', sender_group_nickname: '系统消息' }
    )
    database.dispose()
  })

  it('preserves an ordinary WhatsApp participant named SYSTEM', async () => {
    const sqlite3 = await sqlite3InitModule()
    const database = new MemoryWorkspaceDatabase(sqlite3)
    const runtime = new BrowserSessionRuntime(database, {
      createSessionId: () => 'whatsapp-system-participant',
      now: () => 100,
    })
    const fixture = source('WhatsApp-SYSTEM.txt', '2024/01/02 03:04 - SYSTEM: hello\n')

    const result = await runtime.importSource(fixture)

    assert.deepEqual(result, {
      sessionId: 'whatsapp-system-participant',
      formatId: 'whatsapp-native',
      messageCount: 1,
      memberCount: 1,
      skippedCount: 0,
    })
    assert.equal((await runtime.getSession('whatsapp-system-participant'))?.memberCount, 1)

    const sessionDb = database.getDatabase(sessionDatabaseFilename('whatsapp-system-participant'))
    assert.deepEqual(
      sessionDb?.prepare('SELECT account_name, group_nickname FROM member WHERE platform_id = ?').get('SYSTEM'),
      { account_name: 'SYSTEM', group_nickname: null }
    )
    assert.deepEqual(
      sessionDb
        ?.prepare(
          `SELECT msg.sender_account_name, msg.sender_group_nickname, msg.type
           FROM message msg
           JOIN member m ON m.id = msg.sender_id
           WHERE m.platform_id = ?`
        )
        .get('SYSTEM'),
      { sender_account_name: 'SYSTEM', sender_group_nickname: null, type: 0 }
    )
    database.dispose()
  })

  it('detects and imports a WhatsApp TXT source through the shared browser parser', async () => {
    const sqlite3 = await sqlite3InitModule()
    const database = new MemoryWorkspaceDatabase(sqlite3)
    const runtime = new BrowserSessionRuntime(database, {
      createSessionId: () => 'whatsapp-session',
      now: () => 100,
    })
    const fixture = source(
      '与Alice的 WhatsApp 聊天.txt',
      [
        'Messages and calls are end-to-end encrypted.',
        '2024/01/02 03:04 - Alice: hello whatsapp',
        '2024/01/02 03:05 - Bob: second message',
        '2024/01/02 03:06 - Alice changed the group description',
        '',
      ].join('\n')
    )

    assert.equal(await runtime.detectFormat(fixture), 'whatsapp-native')
    assert.deepEqual(
      runtime.getSupportedFormats().find((format) => format.id === 'whatsapp-native'),
      {
        id: 'whatsapp-native',
        name: 'WhatsApp TXT',
        platform: 'whatsapp',
        extensions: ['.txt'],
      }
    )

    const result = await runtime.importSource(fixture)

    assert.deepEqual(result, {
      sessionId: 'whatsapp-session',
      formatId: 'whatsapp-native',
      messageCount: 3,
      memberCount: 3,
      skippedCount: 0,
    })
    assert.deepEqual(await runtime.listSessions(), [
      {
        id: 'whatsapp-session',
        name: 'Alice',
        platform: 'whatsapp',
        type: 'private',
        importedAt: 100,
        messageCount: 3,
        memberCount: 3,
        groupId: null,
        groupAvatar: null,
        ownerId: null,
        lastMessageTs: Math.floor(new Date('2024-01-02T03:06:00').getTime() / 1000),
        formatId: 'whatsapp-native',
      },
    ])
    const sessionDb = database.getDatabase(sessionDatabaseFilename('whatsapp-session'))
    assert.deepEqual(sessionDb?.prepare('SELECT sender_account_name, content FROM message ORDER BY id').all(), [
      { sender_account_name: 'Alice', content: 'hello whatsapp' },
      { sender_account_name: 'Bob', content: 'second message' },
      { sender_account_name: '系统消息', content: 'Alice changed the group description' },
    ])
    database.dispose()
  })

  it('detects and imports a WeFlow JSON source through the browser runtime', async () => {
    const sqlite3 = await sqlite3InitModule()
    const database = new MemoryWorkspaceDatabase(sqlite3)
    const runtime = new BrowserSessionRuntime(database, {
      createSessionId: () => 'weflow-session',
      now: () => 100,
    })
    const fixture = source('Project Team.json', {
      weflow: { version: '1.0.0', exportedAt: 1_704_164_645 },
      session: {
        wxid: 'project-team@chatroom',
        nickname: 'Project Team',
        displayName: 'Project Team',
        type: '群聊',
      },
      avatars: {
        alice: 'data:image/jpeg;base64,ALICE',
      },
      messages: [
        {
          localId: 1,
          createTime: 1_704_164_645,
          type: '文本消息',
          content: 'hello weflow',
          isSend: 1,
          senderUsername: 'alice',
          senderDisplayName: 'Alice',
          senderAvatarKey: 'alice',
        },
        {
          localId: 2,
          createTime: '1704164646',
          type: '图片消息',
          content: '[图片]',
          isSend: 0,
          senderUsername: 'bob',
          senderDisplayName: 'Bob',
          senderAvatarKey: 'bob',
        },
        {
          localId: 3,
          createTime: null,
          type: '文本消息',
          content: 'invalid timestamp',
          isSend: 0,
          senderUsername: 'alice',
          senderDisplayName: 'Alice',
        },
      ],
    })

    assert.equal(await runtime.detectFormat(fixture), 'weflow')
    assert.deepEqual(
      runtime.getSupportedFormats().find((format) => format.id === 'weflow'),
      {
        id: 'weflow',
        name: 'WeFlow JSON',
        platform: 'weixin',
        extensions: ['.json'],
      }
    )

    const result = await runtime.importSource(fixture)

    assert.deepEqual(result, {
      sessionId: 'weflow-session',
      formatId: 'weflow',
      messageCount: 2,
      memberCount: 2,
      skippedCount: 1,
    })
    assert.deepEqual(
      (await runtime.listSessions()).map((session) => ({
        name: session.name,
        platform: session.platform,
        type: session.type,
        ownerId: session.ownerId,
        formatId: session.formatId,
      })),
      [
        {
          name: 'Project Team',
          platform: 'weixin',
          type: 'group',
          ownerId: 'alice',
          formatId: 'weflow',
        },
      ]
    )
    const sessionDb = database.getDatabase(sessionDatabaseFilename('weflow-session'))
    assert.deepEqual(sessionDb?.prepare('SELECT sender_account_name, type, content FROM message ORDER BY id').all(), [
      { sender_account_name: 'Alice', type: 0, content: 'hello weflow' },
      { sender_account_name: 'Bob', type: 1, content: '[图片]' },
    ])
    database.dispose()
  })

  it('detects and imports a LINE TXT source while preserving the official group type', async () => {
    const sqlite3 = await sqlite3InitModule()
    const database = new MemoryWorkspaceDatabase(sqlite3)
    const runtime = new BrowserSessionRuntime(database, {
      createSessionId: () => 'line-session',
      now: () => 100,
    })
    const fixture = source(
      '[LINE] Project Team.txt',
      [
        '[LINE] Chat history in Project Team',
        'Saved on: 2024/01/03 09:00',
        '',
        '2024.01.02 Tuesday',
        '03:04\tAlice\thello line',
        '03:05\tBob\t[Sticker]',
        '03:06\t\tAlice joined the group',
        '',
      ].join('\n')
    )

    assert.equal(await runtime.detectFormat(fixture), 'line-native')
    assert.deepEqual(
      runtime.getSupportedFormats().find((format) => format.id === 'line-native'),
      {
        id: 'line-native',
        name: 'LINE TXT',
        platform: 'line',
        extensions: ['.txt'],
      }
    )

    const result = await runtime.importSource(fixture)

    assert.deepEqual(result, {
      sessionId: 'line-session',
      formatId: 'line-native',
      messageCount: 3,
      memberCount: 3,
      skippedCount: 0,
    })
    assert.deepEqual(
      (await runtime.listSessions()).map((session) => ({
        name: session.name,
        platform: session.platform,
        type: session.type,
        formatId: session.formatId,
      })),
      [{ name: 'Project Team', platform: 'line', type: 'group', formatId: 'line-native' }]
    )
    const sessionDb = database.getDatabase(sessionDatabaseFilename('line-session'))
    assert.deepEqual(sessionDb?.prepare('SELECT sender_account_name, type, content FROM message ORDER BY id').all(), [
      { sender_account_name: 'Alice', type: 0, content: 'hello line' },
      { sender_account_name: 'Bob', type: 5, content: '[Sticker]' },
      { sender_account_name: '系統', type: 80, content: 'Alice joined the group' },
    ])
    database.dispose()
  })

  it('detects and imports a QQ TXT source through the shared browser parser', async () => {
    const sqlite3 = await sqlite3InitModule()
    const database = new MemoryWorkspaceDatabase(sqlite3)
    const runtime = new BrowserSessionRuntime(database, {
      createSessionId: () => 'qq-session',
      now: () => 100,
    })
    const fixture = source(
      'qq-group.txt',
      [
        '消息记录（此消息记录为文本格式，不支持重新导入）',
        '消息对象:Project Team',
        '2024-01-02 03:04:05 【管理员】Alice(10001)',
        'hello qq',
        '2024-01-02 03:05:06 Bob(10002)',
        '[图片]',
        '',
      ].join('\n')
    )

    assert.equal(await runtime.detectFormat(fixture), 'qq-native')
    assert.deepEqual(
      runtime.getSupportedFormats().find((format) => format.id === 'qq-native'),
      {
        id: 'qq-native',
        name: 'QQ TXT',
        platform: 'qq',
        extensions: ['.txt'],
      }
    )

    const result = await runtime.importSource(fixture)

    assert.deepEqual(result, {
      sessionId: 'qq-session',
      formatId: 'qq-native',
      messageCount: 2,
      memberCount: 2,
      skippedCount: 0,
    })
    assert.deepEqual(
      (await runtime.listSessions()).map((session) => ({
        name: session.name,
        platform: session.platform,
        type: session.type,
        formatId: session.formatId,
      })),
      [{ name: 'Project Team', platform: 'qq', type: 'group', formatId: 'qq-native' }]
    )
    const sessionDb = database.getDatabase(sessionDatabaseFilename('qq-session'))
    assert.deepEqual(sessionDb?.prepare('SELECT sender_account_name, type, content FROM message ORDER BY id').all(), [
      { sender_account_name: 'Alice', type: 0, content: 'hello qq' },
      { sender_account_name: 'Bob', type: 1, content: '[图片]' },
    ])
    database.dispose()
  })

  it('detects and imports a Telegram single-chat JSON source through the shared browser parser', async () => {
    const sqlite3 = await sqlite3InitModule()
    const database = new MemoryWorkspaceDatabase(sqlite3)
    const runtime = new BrowserSessionRuntime(database, {
      createSessionId: () => 'telegram-session',
      now: () => 100,
    })
    const fixture = source(
      'result.json',
      JSON.stringify({
        name: 'Project Team',
        type: 'private_group',
        id: 4242,
        messages: [
          {
            id: 1,
            type: 'message',
            date: '2024-01-02T03:04:05',
            date_unixtime: '1704164645',
            from: 'Alice',
            from_id: 'user10001',
            text: 'hello telegram',
          },
          {
            id: 2,
            type: 'message',
            date: '2024-01-02T03:05:06',
            date_unixtime: '1704164706',
            from: 'Bob',
            from_id: 'user10002',
            text: 'photo caption',
            photo: 'photos/photo_1.jpg',
            reply_to_message_id: 1,
          },
        ],
      })
    )

    assert.equal(await runtime.detectFormat(fixture), 'telegram-native-single')
    assert.deepEqual(
      runtime.getSupportedFormats().find((format) => format.id === 'telegram-native-single'),
      {
        id: 'telegram-native-single',
        name: 'Telegram JSON',
        platform: 'telegram',
        extensions: ['.json'],
      }
    )

    const result = await runtime.importSource(fixture)

    assert.deepEqual(result, {
      sessionId: 'telegram-session',
      formatId: 'telegram-native-single',
      messageCount: 2,
      memberCount: 2,
      skippedCount: 0,
    })
    assert.deepEqual(
      (await runtime.listSessions()).map((session) => ({
        name: session.name,
        platform: session.platform,
        type: session.type,
        groupId: session.groupId,
        formatId: session.formatId,
      })),
      [
        {
          name: 'Project Team',
          platform: 'telegram',
          type: 'group',
          groupId: '4242',
          formatId: 'telegram-native-single',
        },
      ]
    )
    const sessionDb = database.getDatabase(sessionDatabaseFilename('telegram-session'))
    assert.deepEqual(
      sessionDb
        ?.prepare(
          'SELECT platform_message_id, sender_account_name, type, content, reply_to_message_id FROM message ORDER BY id'
        )
        .all(),
      [
        {
          platform_message_id: '1',
          sender_account_name: 'Alice',
          type: 0,
          content: 'hello telegram',
          reply_to_message_id: null,
        },
        {
          platform_message_id: '2',
          sender_account_name: 'Bob',
          type: 1,
          content: '[photo] photo caption',
          reply_to_message_id: '1',
        },
      ]
    )
    database.dispose()
  })

  it('scans a Telegram full export and imports selected chats into isolated session databases', async () => {
    const sqlite3 = await sqlite3InitModule()
    const database = new MemoryWorkspaceDatabase(sqlite3)
    const ids = ['telegram-alice', 'telegram-team']
    const runtime = new BrowserSessionRuntime(database, {
      createSessionId: () => ids.shift() ?? 'unexpected',
      now: () => 100,
    })
    const fixture = source('result.json', {
      about: 'This file was exported by Telegram Desktop.',
      chats: {
        list: [
          {
            name: 'Alice',
            type: 'personal_chat',
            id: 10001,
            messages: [
              {
                id: 1,
                type: 'message',
                date: '2024-01-02T03:04:05',
                date_unixtime: '1704164645',
                from: 'Alice',
                from_id: 'user10001',
                text: 'hello alice',
              },
            ],
          },
          {
            name: 'Project Team',
            type: 'private_group',
            id: 4242,
            messages: [
              {
                id: 2,
                type: 'message',
                date: '2024-01-02T03:05:06',
                date_unixtime: '1704164706',
                from: 'Bob',
                from_id: 'user10002',
                text: 'hello team',
              },
            ],
          },
        ],
      },
    })

    assert.equal(await runtime.detectFormat(fixture), 'telegram-native')
    assert.deepEqual(
      runtime.getSupportedFormats().find((format) => format.id === 'telegram-native'),
      {
        id: 'telegram-native',
        name: 'Telegram JSON',
        platform: 'telegram',
        extensions: ['.json'],
        multiChat: true,
      }
    )
    assert.deepEqual(await runtime.scanMultiChatSource(fixture), [
      { index: 0, name: 'Alice', type: 'personal_chat', id: 10001, messageCount: 1 },
      { index: 1, name: 'Project Team', type: 'private_group', id: 4242, messageCount: 1 },
    ])

    const alice = await runtime.importSource(fixture, { formatId: 'telegram-native', chatIndex: 0 })
    const team = await runtime.importSource(fixture, { formatId: 'telegram-native', chatIndex: 1 })

    assert.equal(alice.sessionId, 'telegram-alice')
    assert.equal(team.sessionId, 'telegram-team')
    assert.deepEqual(
      (await runtime.listSessions()).map((session) => ({ id: session.id, name: session.name })),
      [
        { id: 'telegram-team', name: 'Project Team' },
        { id: 'telegram-alice', name: 'Alice' },
      ]
    )
    assert.deepEqual(
      database.getDatabase(sessionDatabaseFilename('telegram-alice'))?.prepare('SELECT content FROM message').all(),
      [{ content: 'hello alice' }]
    )
    assert.deepEqual(
      database.getDatabase(sessionDatabaseFilename('telegram-team'))?.prepare('SELECT content FROM message').all(),
      [{ content: 'hello team' }]
    )

    await runtime.deleteSession('telegram-alice')
    assert.ok(database.getDatabase(sessionDatabaseFilename('telegram-team')))
    assert.equal(database.getDatabase(sessionDatabaseFilename('telegram-alice')), undefined)
    database.dispose()
  })

  it('removes the catalog row and generated session database after a write failure', async () => {
    const sqlite3 = await sqlite3InitModule()
    const database = new MemoryWorkspaceDatabase(sqlite3)
    const runtime = new BrowserSessionRuntime(database, {
      createSessionId: () => 'failed-session',
      now: () => 100,
    })
    database.failOnFilename = sessionDatabaseFilename('failed-session')

    await assert.rejects(
      runtime.importSource(source('failed.json', chat('Failed', 'alice', 1)), { formatId: 'chatlab' }),
      /simulated database write failure/
    )

    database.failOnFilename = undefined
    assert.deepEqual(await runtime.listSessions(), [])
    assert.equal(database.getDatabase(sessionDatabaseFilename('failed-session')), undefined)
    database.dispose()
  })

  it('cleans an interrupted import on the next catalog read and supports cancellation before writing', async () => {
    const sqlite3 = await sqlite3InitModule()
    const database = new MemoryWorkspaceDatabase(sqlite3)
    const runtime = new BrowserSessionRuntime(database, {
      createSessionId: () => 'cancelled-session',
      now: () => 100,
    })
    let cancel = false

    await assert.rejects(
      runtime.importSource(source('cancelled.json', chat('Cancelled', 'alice', 1)), {
        formatId: 'chatlab',
        onProgress: (progress) => {
          if (progress.stage === 'catalog') cancel = true
        },
        checkCancelled: () => {
          if (cancel) throw new Error('cancelled')
        },
      }),
      /cancelled/
    )
    assert.deepEqual(await runtime.listSessions(), [])
    assert.equal(database.getDatabase(sessionDatabaseFilename('cancelled-session')), undefined)

    await database.withDatabase(sessionDatabaseFilename('interrupted-session'), CHAT_DB_TABLES, () => undefined)
    const catalog = new BrowserSessionCatalog(database)
    await catalog.beginImport({
      id: 'interrupted-session',
      name: 'Interrupted',
      platform: 'unknown',
      type: 'group',
      importedAt: 100,
      messageCount: 0,
      memberCount: 0,
      groupId: null,
      groupAvatar: null,
      ownerId: null,
      lastMessageTs: null,
      formatId: 'chatlab',
    })

    assert.deepEqual(await runtime.listSessions(), [])
    assert.equal(database.getDatabase(sessionDatabaseFilename('interrupted-session')), undefined)
    database.dispose()
  })

  it('connects the hourly query and preserves the missing-session guard', async () => {
    const sqlite3 = await sqlite3InitModule()
    const database = new MemoryWorkspaceDatabase(sqlite3)
    const runtime = new BrowserSessionRuntime(database, {
      createSessionId: () => 'query-session',
      now: () => 100,
    })
    const timestamp = 1_700_000_000

    await runtime.importSource(source('query.json', chat('Query', 'alice', timestamp)), { formatId: 'chatlab' })
    const hourly = await runtime.getHourlyActivity('query-session')

    assert.ok(hourly.length > 0)

    const filenamesBeforeMissingQuery = await database.getDatabaseFilenames()
    await assert.rejects(runtime.getHourlyActivity('missing-session'), /Session missing-session was not found/)
    assert.deepEqual(await database.getDatabaseFilenames(), filenamesBeforeMissingQuery)
    database.dispose()
  })

  it('connects the member activity query and preserves the missing-session guard', async () => {
    const sqlite3 = await sqlite3InitModule()
    const database = new MemoryWorkspaceDatabase(sqlite3)
    const runtime = new BrowserSessionRuntime(database, {
      createSessionId: () => 'member-query-session',
      now: () => 100,
    })
    const timestamp = 1_700_000_000
    const fixture = {
      chatlab: { version: '1', exportedAt: timestamp },
      meta: { name: 'Member Query', platform: 'wechat', type: 'group', ownerId: 'alice' },
      members: [
        { platformId: 'alice', accountName: 'Alice' },
        { platformId: 'bob', accountName: 'Bob' },
      ],
      messages: [
        { sender: 'alice', accountName: 'Alice', timestamp, type: 0, content: 'one' },
        { sender: 'alice', accountName: 'Alice', timestamp: timestamp + 1, type: 0, content: 'two' },
        { sender: 'bob', accountName: 'Bob', timestamp: timestamp + 2, type: 0, content: 'three' },
      ],
    }

    await runtime.importSource(source('member-query.json', fixture), { formatId: 'chatlab' })

    const ranking = await runtime.getMemberActivity('member-query-session')
    assert.ok(ranking.length > 0)

    const filenamesBeforeMissingQuery = await database.getDatabaseFilenames()
    await assert.rejects(runtime.getMemberActivity('missing-session'), /Session missing-session was not found/)
    assert.deepEqual(await database.getDatabaseFilenames(), filenamesBeforeMissingQuery)
    database.dispose()
  })

  it('connects the message type query and preserves the missing-session guard', async () => {
    const sqlite3 = await sqlite3InitModule()
    const database = new MemoryWorkspaceDatabase(sqlite3)
    const runtime = new BrowserSessionRuntime(database, {
      createSessionId: () => 'message-type-query-session',
      now: () => 100,
    })
    const timestamp = 1_700_000_000
    const fixture = {
      chatlab: { version: '1', exportedAt: timestamp },
      meta: { name: 'Message Type Query', platform: 'wechat', type: 'group', ownerId: 'alice' },
      members: [{ platformId: 'alice', accountName: 'Alice' }],
      messages: [
        { sender: 'alice', accountName: 'Alice', timestamp, type: 0, content: 'one' },
        { sender: 'alice', accountName: 'Alice', timestamp: timestamp + 1, type: 1, content: '[image]' },
        { sender: 'alice', accountName: 'Alice', timestamp: timestamp + 2, type: 1, content: '[image]' },
      ],
    }

    await runtime.importSource(source('message-type-query.json', fixture), { formatId: 'chatlab' })

    const distribution = await runtime.getMessageTypeDistribution('message-type-query-session')
    assert.ok(distribution.length > 0)

    const filenamesBeforeMissingQuery = await database.getDatabaseFilenames()
    await assert.rejects(runtime.getMessageTypeDistribution('missing-session'), /Session missing-session was not found/)
    assert.deepEqual(await database.getDatabaseFilenames(), filenamesBeforeMissingQuery)
    database.dispose()
  })

  it('connects the overview query group and preserves the missing-session guard', async () => {
    const sqlite3 = await sqlite3InitModule()
    const database = new MemoryWorkspaceDatabase(sqlite3)
    const runtime = new BrowserSessionRuntime(database, {
      createSessionId: () => 'overview-query-session',
      now: () => 100,
    })
    const firstTimestamp = Math.floor(new Date(2024, 0, 2, 10, 0, 0).getTime() / 1000)
    const secondTimestamp = Math.floor(new Date(2024, 0, 3, 10, 0, 0).getTime() / 1000)
    const fixture = {
      chatlab: { version: '1', exportedAt: firstTimestamp },
      meta: { name: 'Overview Query', platform: 'wechat', type: 'private', ownerId: 'alice' },
      members: [{ platformId: 'alice', accountName: 'Alice' }],
      messages: [
        { sender: 'alice', accountName: 'Alice', timestamp: firstTimestamp, type: 0, content: 'one' },
        { sender: 'alice', accountName: 'Alice', timestamp: firstTimestamp + 1, type: 0, content: 'two' },
        { sender: 'alice', accountName: 'Alice', timestamp: secondTimestamp, type: 0, content: 'three' },
      ],
    }

    await runtime.importSource(source('overview-query.json', fixture), { formatId: 'chatlab' })

    const [daily, weekday, timeRange, years, lengthDistribution, textStats, longMessageCount, percentiles] =
      await Promise.all([
        runtime.getDailyActivity('overview-query-session'),
        runtime.getWeekdayActivity('overview-query-session'),
        runtime.getTimeRange('overview-query-session'),
        runtime.getAvailableYears('overview-query-session'),
        runtime.getMessageLengthDistribution('overview-query-session'),
        runtime.getTextStats('overview-query-session'),
        runtime.getLongMessageCount('overview-query-session'),
        runtime.getTextLengthPercentiles('overview-query-session'),
      ])
    assert.ok(daily.length > 0)
    assert.ok(weekday.some((item) => item.messageCount > 0))
    if (!timeRange) assert.fail('time range query should return imported session bounds')
    assert.ok(timeRange.start && timeRange.end)
    assert.ok(years.length > 0)
    assert.ok(lengthDistribution.detail.length > 0)
    assert.ok(textStats.textCount > 0)
    assert.equal(typeof longMessageCount, 'number')
    assert.equal(typeof percentiles.p50, 'number')

    const filenamesBeforeMissingQuery = await database.getDatabaseFilenames()
    await assert.rejects(runtime.getDailyActivity('missing-session'), /Session missing-session was not found/)
    assert.deepEqual(await database.getDatabaseFilenames(), filenamesBeforeMissingQuery)
    database.dispose()
  })

  it('connects the remaining insight queries and builds relationship indexes on demand', async () => {
    const sqlite3 = await sqlite3InitModule()
    const database = new MemoryWorkspaceDatabase(sqlite3)
    const runtime = new BrowserSessionRuntime(database, {
      createSessionId: () => 'insight-query-session',
      now: () => 100,
    })
    const firstTimestamp = Math.floor(new Date(2024, 0, 2, 10, 0, 0).getTime() / 1000)
    const fixture = {
      chatlab: { version: '1', exportedAt: firstTimestamp },
      meta: { name: 'Insight Query', platform: 'wechat', type: 'private', ownerId: 'alice' },
      members: [
        { platformId: 'alice', accountName: 'Alice' },
        { platformId: 'bob', accountName: 'Bob' },
      ],
      messages: [
        { sender: 'alice', accountName: 'Alice', timestamp: firstTimestamp, type: 0, content: 'hello topic @Bob' },
        {
          sender: 'bob',
          accountName: 'Bob',
          timestamp: firstTimestamp + 60,
          type: 0,
          content: 'hello topic',
        },
        {
          sender: 'alice',
          accountName: 'Alice',
          timestamp: firstTimestamp + 4_000,
          type: 0,
          content: 'hello project @Bob',
        },
        {
          sender: 'bob',
          accountName: 'Bob',
          timestamp: firstTimestamp + 4_060,
          type: 0,
          content: 'hello project',
        },
      ],
    }

    await runtime.importSource(source('insight-query.json', fixture), { formatId: 'chatlab' })

    const [monthly, yearly, memberTrend, members, mentions, mentionGraph, clusterGraph, language, wordFrequency] =
      await Promise.all([
        runtime.getMonthlyActivity('insight-query-session'),
        runtime.getYearlyActivity('insight-query-session'),
        runtime.getMemberMonthlyTrend('insight-query-session'),
        runtime.getMembers('insight-query-session'),
        runtime.getMentionAnalysis('insight-query-session'),
        runtime.getMentionGraph('insight-query-session'),
        runtime.getClusterGraph('insight-query-session'),
        runtime.getLanguagePreferenceAnalysis('insight-query-session', 'en-US'),
        runtime.getWordFrequency('insight-query-session', {
          locale: 'en-US',
          topN: 10,
          minCount: 2,
          posFilterMode: 'all',
          enableStopwords: false,
        }),
      ])
    assert.ok(monthly.length > 0)
    assert.ok(yearly.length > 0)
    assert.ok(memberTrend.length > 0)
    assert.ok(members.length > 0)
    assert.ok(mentions.totalMentions > 0)
    assert.ok(mentionGraph.links.length > 0)
    assert.ok(clusterGraph.links.length > 0)
    assert.ok(language.members.length > 0)
    assert.ok(wordFrequency.words.length > 0)

    const relationship = await runtime.getRelationshipStats('insight-query-session')
    assert.equal(relationship.hasSessionIndex, true)

    const journey = await runtime.getJourneyStats('insight-query-session')
    assert.equal(journey.hasSessionIndex, true)

    const filenamesBeforeMissingQuery = await database.getDatabaseFilenames()
    await assert.rejects(runtime.getMonthlyActivity('missing-session'), /Session missing-session was not found/)
    assert.deepEqual(await database.getDatabaseFilenames(), filenamesBeforeMissingQuery)
    database.dispose()
  })
})
