import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { AIChatManager } from '../chats'
import type { ChartPayload } from '@openchatlab/core'

const sqliteNativeBinding = process.env.CHATLAB_TEST_SQLITE_NATIVE_BINDING

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'chatlab-ai-conv-'))
}

function createTestDatabase(filename: string): Database.Database {
  return sqliteNativeBinding ? new Database(filename, { nativeBinding: sqliteNativeBinding }) : new Database(filename)
}

function createManager(dir: string): AIChatManager {
  return sqliteNativeBinding
    ? new AIChatManager(dir, { nativeBinding: sqliteNativeBinding })
    : new AIChatManager(dir)
}

function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  } catch {
    // Windows can hold SQLite WAL handles briefly after close; temp cleanup is best-effort.
  }
}

describe('AIChatManager legacy migration', () => {
  it('creates ai_chat schema for fresh databases', () => {
    const dir = createTempDir()
    try {
      const manager = createManager(dir)
      const conv = manager.createAIChat('session-1', 'Fresh', 'general_cn')
      manager.addMessage(conv.id, 'user', 'hello')
      manager.close()

      const db = createTestDatabase(join(dir, 'conversations.db'))
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as Array<{ name: string }>
      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name")
        .all() as Array<{ name: string }>
      const messageColumns = db.pragma('table_info(ai_message)') as Array<{ name: string }>

      assert.ok(tables.some((table) => table.name === 'ai_chat'))
      assert.ok(tables.some((table) => table.name === 'ai_message'))
      assert.ok(indexes.some((index) => index.name === 'idx_ai_chat_session'))
      assert.ok(indexes.some((index) => index.name === 'idx_ai_message_ai_chat'))
      assert.ok(messageColumns.some((column) => column.name === 'ai_chat_id'))
      assert.equal(
        (db.prepare('SELECT session_id as sessionId FROM ai_chat WHERE id = ?').get(conv.id) as { sessionId: string })
          .sessionId,
        'session-1'
      )
      db.close()
    } finally {
      cleanup(dir)
    }
  })

  it('migrates legacy ai_conversation rows into ai_chat', () => {
    const dir = createTempDir()
    try {
      const db = createTestDatabase(join(dir, 'conversations.db'))
      db.exec(`
        CREATE TABLE ai_conversation (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          title TEXT,
          assistant_id TEXT DEFAULT 'general_cn',
          active_message_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE ai_message (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          data_keywords TEXT,
          data_message_count INTEGER,
          content_blocks TEXT,
          token_usage TEXT,
          debug_context TEXT,
          parent_id TEXT,
          sibling_group_id TEXT,
          branch_index INTEGER DEFAULT 0
        );
        CREATE INDEX idx_ai_conversation_session ON ai_conversation(session_id);
        CREATE INDEX idx_ai_message_conversation ON ai_message(conversation_id);
      `)
      db.prepare('INSERT INTO ai_conversation VALUES (?, ?, ?, ?, NULL, ?, ?)').run(
        'conv-migrate',
        'session-1',
        'Legacy AI Chat',
        'general_cn',
        1,
        3
      )
      db.prepare('INSERT INTO ai_message VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)').run(
        'lm1',
        'conv-migrate',
        'user',
        'first',
        1
      )
      db.prepare('INSERT INTO ai_message VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)').run(
        'lm2',
        'conv-migrate',
        'assistant',
        'second',
        2
      )
      db.close()

      const manager = createManager(dir)
      const messages = manager.getMessages('conv-migrate')
      assert.deepEqual(
        messages.map((message) => message.content),
        ['first', 'second']
      )
      manager.close()

      const migrated = createTestDatabase(join(dir, 'conversations.db'))
      const tables = migrated
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as Array<{ name: string }>
      const messageColumns = migrated.pragma('table_info(ai_message)') as Array<{ name: string }>
      const chat = migrated.prepare('SELECT id, session_id as sessionId, title FROM ai_chat').get() as {
        id: string
        sessionId: string
        title: string
      }
      const messageRows = migrated
        .prepare('SELECT id, ai_chat_id as aiChatId, content FROM ai_message ORDER BY timestamp ASC')
        .all() as Array<{ id: string; aiChatId: string; content: string }>

      assert.ok(tables.some((table) => table.name === 'ai_chat'))
      assert.ok(!tables.some((table) => table.name === 'ai_conversation'))
      assert.ok(messageColumns.some((column) => column.name === 'ai_chat_id'))
      assert.ok(!messageColumns.some((column) => column.name === 'conversation_id'))
      assert.deepEqual(chat, { id: 'conv-migrate', sessionId: 'session-1', title: 'Legacy AI Chat' })
      assert.deepEqual(
        messageRows.map((row) => ({ aiChatId: row.aiChatId, content: row.content })),
        [
          { aiChatId: 'conv-migrate', content: 'first' },
          { aiChatId: 'conv-migrate', content: 'second' },
        ]
      )
      migrated.close()
    } finally {
      cleanup(dir)
    }
  })

  it('migrates legacy flat messages into an active path', () => {
    const dir = createTempDir()
    try {
      const db = createTestDatabase(join(dir, 'conversations.db'))
      db.exec(`
        CREATE TABLE ai_conversation (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          title TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE ai_message (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          data_keywords TEXT,
          data_message_count INTEGER,
          content_blocks TEXT
        );
      `)
      db.prepare('INSERT INTO ai_conversation VALUES (?, ?, ?, ?, ?)').run('conv-1', 'session-1', 'Legacy', 1, 4)
      db.prepare('INSERT INTO ai_message VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL)').run(
        'm1',
        'conv-1',
        'user',
        'one',
        1
      )
      db.prepare('INSERT INTO ai_message VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL)').run(
        'm2',
        'conv-1',
        'assistant',
        'two',
        2
      )
      db.close()

      const manager = createManager(dir)
      const messages = manager.getMessages('conv-1')
      assert.deepEqual(
        messages.map((message) => message.content),
        ['one', 'two']
      )
      assert.equal(messages[0]?.parentId, null)
      assert.equal(messages[1]?.parentId, 'm1')
      assert.equal(manager.getAIChat('conv-1')?.activeMessageId, 'm2')
      manager.close()
    } finally {
      cleanup(dir)
    }
  })

  it('repairs partially migrated legacy rows that already have tree columns', () => {
    const dir = createTempDir()
    try {
      const db = createTestDatabase(join(dir, 'conversations.db'))
      db.exec(`
        CREATE TABLE ai_conversation (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          title TEXT,
          assistant_id TEXT DEFAULT 'general_cn',
          active_message_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE ai_message (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          data_keywords TEXT,
          data_message_count INTEGER,
          content_blocks TEXT,
          token_usage TEXT,
          debug_context TEXT,
          parent_id TEXT,
          sibling_group_id TEXT,
          branch_index INTEGER DEFAULT 0
        );
      `)
      db.prepare('INSERT INTO ai_conversation VALUES (?, ?, ?, ?, NULL, ?, ?)').run(
        'conv-partial',
        'session-1',
        'Partial',
        'general_cn',
        1,
        3
      )
      db.prepare('INSERT INTO ai_message VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)').run(
        'pm1',
        'conv-partial',
        'user',
        'first',
        1
      )
      db.prepare('INSERT INTO ai_message VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)').run(
        'pm2',
        'conv-partial',
        'assistant',
        'second',
        2
      )
      db.close()

      const manager = createManager(dir)
      const messages = manager.getMessages('conv-partial')
      assert.deepEqual(
        messages.map((message) => message.content),
        ['first', 'second']
      )
      assert.equal(messages[0]?.parentId, null)
      assert.equal(messages[1]?.parentId, 'pm1')
      assert.equal(manager.getAIChat('conv-partial')?.activeMessageId, 'pm2')
      manager.close()
    } finally {
      cleanup(dir)
    }
  })
})

describe('AIChatManager message editing', () => {
  it('updateMessageContent updates message text in place', () => {
    const dir = createTempDir()
    try {
      const manager = createManager(dir)
      const conv = manager.createAIChat('s1', 'Test', 'general_cn')
      const msg = manager.addMessage(conv.id, 'user', 'original text')
      manager.addMessage(conv.id, 'assistant', 'reply')

      manager.updateMessageContent(msg.id, 'edited text')

      const messages = manager.getMessages(conv.id)
      assert.equal(messages[0]?.content, 'edited text')
      assert.equal(messages[1]?.content, 'reply')
      manager.close()
    } finally {
      cleanup(dir)
    }
  })

  it('updateMessageContent throws for non-existent message', () => {
    const dir = createTempDir()
    try {
      const manager = createManager(dir)
      assert.throws(() => manager.updateMessageContent('non-existent', 'text'), /Message not found/)
      manager.close()
    } finally {
      cleanup(dir)
    }
  })

  it('deleteAndRelinkMessage removes a message and rewires children', () => {
    const dir = createTempDir()
    try {
      const manager = createManager(dir)
      const conv = manager.createAIChat('s1', 'Test', 'general_cn')
      const userMsg = manager.addMessage(conv.id, 'user', 'question')
      const aiMsg = manager.addMessage(conv.id, 'assistant', 'answer')
      const followUp = manager.addMessage(conv.id, 'user', 'follow up')
      manager.addMessage(conv.id, 'assistant', 'follow answer')

      manager.deleteAndRelinkMessage(conv.id, aiMsg.id)

      const messages = manager.getMessages(conv.id)
      assert.equal(messages.length, 3)
      assert.deepEqual(
        messages.map((m) => m.content),
        ['question', 'follow up', 'follow answer']
      )
      // follow up's parent should now be userMsg (was aiMsg)
      assert.equal(messages[1]?.parentId, userMsg.id)
      assert.equal(messages[2]?.parentId, followUp.id)
      manager.close()
    } finally {
      cleanup(dir)
    }
  })

  it('deleteAndRelinkMessage updates activeMessageId when removing the active leaf', () => {
    const dir = createTempDir()
    try {
      const manager = createManager(dir)
      const conv = manager.createAIChat('s1', 'Test', 'general_cn')
      const userMsg = manager.addMessage(conv.id, 'user', 'question')
      const aiMsg = manager.addMessage(conv.id, 'assistant', 'answer')
      assert.equal(manager.getAIChat(conv.id)?.activeMessageId, aiMsg.id)

      manager.deleteAndRelinkMessage(conv.id, aiMsg.id)

      assert.equal(manager.getAIChat(conv.id)?.activeMessageId, userMsg.id)
      const messages = manager.getMessages(conv.id)
      assert.equal(messages.length, 1)
      assert.equal(messages[0]?.content, 'question')
      manager.close()
    } finally {
      cleanup(dir)
    }
  })

  it('insertMessageAfter inserts a message in the middle of a chain', () => {
    const dir = createTempDir()
    try {
      const manager = createManager(dir)
      const conv = manager.createAIChat('s1', 'Test', 'general_cn')
      const userMsg = manager.addMessage(conv.id, 'user', 'question')
      const followUp = manager.addMessage(conv.id, 'user', 'follow up')
      manager.addMessage(conv.id, 'assistant', 'follow answer')

      const inserted = manager.insertMessageAfter(conv.id, userMsg.id, 'assistant', 'inserted answer')

      const messages = manager.getMessages(conv.id)
      assert.equal(messages.length, 4)
      assert.deepEqual(
        messages.map((m) => m.content),
        ['question', 'inserted answer', 'follow up', 'follow answer']
      )
      assert.equal(inserted.parentId, userMsg.id)
      // followUp's parent should be updated to the inserted message
      assert.equal(messages[2]?.id, followUp.id)
      assert.equal(messages[2]?.parentId, inserted.id)
      manager.close()
    } finally {
      cleanup(dir)
    }
  })

  it('insertMessageAfter appends to the end when no child exists', () => {
    const dir = createTempDir()
    try {
      const manager = createManager(dir)
      const conv = manager.createAIChat('s1', 'Test', 'general_cn')
      const userMsg = manager.addMessage(conv.id, 'user', 'question')

      const inserted = manager.insertMessageAfter(conv.id, userMsg.id, 'assistant', 'new answer')

      const messages = manager.getMessages(conv.id)
      assert.equal(messages.length, 2)
      assert.deepEqual(
        messages.map((m) => m.content),
        ['question', 'new answer']
      )
      assert.equal(inserted.parentId, userMsg.id)
      manager.close()
    } finally {
      cleanup(dir)
    }
  })
})

describe('AIChatManager chart content blocks', () => {
  it('persists normalized chart payloads for stable replay', () => {
    const dir = createTempDir()
    try {
      const chart: ChartPayload = {
        version: 1,
        spec: {
          version: 1,
          type: 'bar',
          title: 'Messages by member',
          encoding: { x: 'name', y: 'message_count' },
        },
        dataset: {
          columns: [
            { name: 'name', type: 'category' },
            { name: 'message_count', type: 'integer' },
          ],
          rows: [
            { name: 'Alice', message_count: 4 },
            { name: 'Bob', message_count: 3 },
          ],
        },
        data: {
          labels: ['Alice', 'Bob'],
          values: [4, 3],
        },
        rowCount: 2,
      }

      const manager = createManager(dir)
      const conv = manager.createAIChat('s1', 'Chart Replay', 'general_cn')
      manager.addMessage(conv.id, 'user', 'draw a chart')
      manager.addMessage(conv.id, 'assistant', 'Here is the chart.', undefined, undefined, [{ type: 'chart', chart }])
      manager.close()

      const reloaded = createManager(dir)
      const messages = reloaded.getMessages(conv.id)
      const block = messages[1]?.contentBlocks?.[0]

      if (!block || block.type !== 'chart') {
        assert.fail('Expected a chart content block')
      }
      assert.deepEqual(block?.chart, chart)
      reloaded.close()
    } finally {
      cleanup(dir)
    }
  })
})

describe('AIChatManager deleteMessagesFrom', () => {
  it('deletes the target message and all subsequent messages', () => {
    const dir = createTempDir()
    try {
      const manager = createManager(dir)
      const conv = manager.createAIChat('s1', 'Test', 'general_cn')
      const user1 = manager.addMessage(conv.id, 'user', 'q1')
      manager.addMessage(conv.id, 'assistant', 'a1')
      manager.addMessage(conv.id, 'user', 'q2')
      manager.addMessage(conv.id, 'assistant', 'a2')

      manager.deleteMessagesFrom(conv.id, user1.id)

      const messages = manager.getMessages(conv.id)
      assert.equal(messages.length, 0)
      assert.equal(manager.getAIChat(conv.id)?.activeMessageId, null)
      manager.close()
    } finally {
      cleanup(dir)
    }
  })

  it('deletes from a mid-chain message, preserving earlier ones', () => {
    const dir = createTempDir()
    try {
      const manager = createManager(dir)
      const conv = manager.createAIChat('s1', 'Test', 'general_cn')
      const user1 = manager.addMessage(conv.id, 'user', 'q1')
      const ai1 = manager.addMessage(conv.id, 'assistant', 'a1')
      manager.addMessage(conv.id, 'user', 'q2')
      manager.addMessage(conv.id, 'assistant', 'a2')

      manager.deleteMessagesFrom(conv.id, ai1.id)

      const messages = manager.getMessages(conv.id)
      assert.equal(messages.length, 1)
      assert.equal(messages[0]?.content, 'q1')
      assert.equal(manager.getAIChat(conv.id)?.activeMessageId, user1.id)
      manager.close()
    } finally {
      cleanup(dir)
    }
  })
})

describe('AIChatManager forkAIChat', () => {
  it('creates a new conversation with copied messages up to the specified point', () => {
    const dir = createTempDir()
    try {
      const manager = createManager(dir)
      const conv = manager.createAIChat('s1', 'Original', 'general_cn')
      manager.addMessage(conv.id, 'user', 'q1')
      manager.addMessage(conv.id, 'assistant', 'a1')
      const q2 = manager.addMessage(conv.id, 'user', 'q2')
      manager.addMessage(conv.id, 'assistant', 'a2')

      const forked = manager.forkAIChat(conv.id, q2.id, 'Forked')

      assert.notEqual(forked.id, conv.id)
      assert.equal(forked.title, 'Forked')
      assert.equal(forked.sessionId, 's1')

      const forkedMessages = manager.getMessages(forked.id)
      assert.equal(forkedMessages.length, 3)
      assert.deepEqual(
        forkedMessages.map((m) => m.content),
        ['q1', 'a1', 'q2']
      )

      // Original conversation should be untouched
      const originalMessages = manager.getMessages(conv.id)
      assert.equal(originalMessages.length, 4)
      manager.close()
    } finally {
      cleanup(dir)
    }
  })

  it('uses default fork title when none provided', () => {
    const dir = createTempDir()
    try {
      const manager = createManager(dir)
      const conv = manager.createAIChat('s1', 'MyChat', 'general_cn')
      manager.addMessage(conv.id, 'user', 'q1')
      const a1 = manager.addMessage(conv.id, 'assistant', 'a1')

      const forked = manager.forkAIChat(conv.id, a1.id)

      assert.equal(forked.title, 'MyChat (fork)')
      const forkedMessages = manager.getMessages(forked.id)
      assert.equal(forkedMessages.length, 2)
      assert.deepEqual(
        forkedMessages.map((m) => m.content),
        ['q1', 'a1']
      )
      manager.close()
    } finally {
      cleanup(dir)
    }
  })
})
