import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { AIConversationManager } from '../conversations'

const sqliteNativeBinding = process.env.CHATLAB_TEST_SQLITE_NATIVE_BINDING

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'chatlab-ai-conv-'))
}

function createTestDatabase(filename: string): Database.Database {
  return sqliteNativeBinding ? new Database(filename, { nativeBinding: sqliteNativeBinding }) : new Database(filename)
}

function createManager(dir: string): AIConversationManager {
  return sqliteNativeBinding
    ? new AIConversationManager(dir, { nativeBinding: sqliteNativeBinding })
    : new AIConversationManager(dir)
}

function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  } catch {
    // Windows can hold SQLite WAL handles briefly after close; temp cleanup is best-effort.
  }
}

describe('AIConversationManager message branches', () => {
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
      assert.equal(manager.getConversation('conv-1')?.activeMessageId, 'm2')
      manager.close()
    } finally {
      cleanup(dir)
    }
  })

  it('does not rerun legacy backfill over existing root branches', () => {
    const dir = createTempDir()
    try {
      let manager = createManager(dir)
      const conversation = manager.createConversation('session-1', 'Root branch', 'general_cn')
      const root = manager.addMessage(conversation.id, 'user', 'original root')
      manager.addMessage(conversation.id, 'assistant', 'original answer')
      const branch = manager.createMessageBranch(root.id, 'edited root', 'edited answer')
      assert.equal(branch.userMessage.parentId, null)
      manager.close()

      manager = createManager(dir)
      const messages = manager.getMessages(conversation.id)
      assert.deepEqual(
        messages.map((message) => message.content),
        ['edited root', 'edited answer']
      )
      assert.equal(messages[0]?.parentId, null)
      assert.equal(manager.getConversation(conversation.id)?.activeMessageId, branch.assistantMessage.id)
      manager.close()
    } finally {
      cleanup(dir)
    }
  })

  it('creates editable branches without losing the original path', () => {
    const dir = createTempDir()
    try {
      const manager = createManager(dir)
      const conversation = manager.createConversation('session-1', 'Branch', 'general_cn')
      const user1 = manager.addMessage(conversation.id, 'user', 'original question')
      manager.addMessage(conversation.id, 'assistant', 'original answer', undefined, undefined, undefined, {
        promptTokens: 1,
        completionTokens: 2,
        totalTokens: 3,
      })
      manager.addMessage(conversation.id, 'user', 'follow up')
      const oldLeaf = manager.addMessage(
        conversation.id,
        'assistant',
        'follow answer',
        undefined,
        undefined,
        undefined,
        {
          promptTokens: 4,
          completionTokens: 5,
          totalTokens: 9,
        }
      )

      const branch = manager.createMessageBranch('' + user1.id, 'edited question', 'edited answer', undefined, {
        promptTokens: 10,
        completionTokens: 11,
        totalTokens: 21,
      })

      assert.deepEqual(
        manager.getMessages(conversation.id).map((message) => message.content),
        ['edited question', 'edited answer']
      )
      assert.equal(branch.userMessage.branch?.total, 2)
      assert.equal(manager.getHistoryForAgent(conversation.id, undefined, branch.userMessage.parentId).length, 0)
      assert.deepEqual(manager.getConversationTokenUsage(conversation.id), {
        promptTokens: 10,
        completionTokens: 11,
        totalTokens: 21,
      })

      manager.switchMessageBranch(conversation.id, user1.id)
      assert.deepEqual(
        manager.getMessages(conversation.id).map((message) => message.content),
        ['original question', 'original answer', 'follow up', 'follow answer']
      )
      assert.equal(manager.getConversation(conversation.id)?.activeMessageId, oldLeaf.id)
      assert.deepEqual(manager.getConversationTokenUsage(conversation.id), {
        promptTokens: 5,
        completionTokens: 7,
        totalTokens: 12,
      })
      manager.close()
    } finally {
      cleanup(dir)
    }
  })

  it('keeps summaries on inactive branches when adding a new summary', () => {
    const dir = createTempDir()
    try {
      const manager = createManager(dir)
      const conversation = manager.createConversation('session-1', 'Summary branch', 'general_cn')
      manager.addMessage(conversation.id, 'user', 'intro')
      manager.addMessage(conversation.id, 'assistant', 'answer')
      manager.addSummaryMessage(conversation.id, 'original summary', {
        bufferBoundaryTimestamp: 2,
        compressedMessageCount: 2,
      })
      const followUp = manager.addMessage(conversation.id, 'user', 'follow up')
      manager.addMessage(conversation.id, 'assistant', 'follow answer')

      manager.createMessageBranch(followUp.id, 'edited follow up', 'edited follow answer')
      manager.addSummaryMessage(conversation.id, 'edited summary', {
        bufferBoundaryTimestamp: 4,
        compressedMessageCount: 2,
      })
      manager.switchMessageBranch(conversation.id, followUp.id)

      assert.deepEqual(
        manager.getMessages(conversation.id).map((message) => message.content),
        ['intro', 'answer', 'original summary', 'follow up', 'follow answer']
      )
      manager.close()
    } finally {
      cleanup(dir)
    }
  })
})
