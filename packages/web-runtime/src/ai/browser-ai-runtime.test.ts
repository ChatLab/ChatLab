import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import sqlite3InitModule, { type Database, type Sqlite3Static } from '@sqlite.org/sqlite-wasm'
import { CHAT_DB_TABLES, type DatabaseAdapter } from '@openchatlab/core'

import { SqliteWasmDatabaseAdapter } from '../sqlite/adapter'
import type { WorkspaceDatabasePort } from '../storage/workspace-database'
import { BrowserAIConversationRepository } from './conversation-repository'
import { BrowserAIToolRuntime } from './tool-runtime'

class MemoryWorkspaceDatabase implements WorkspaceDatabasePort {
  private readonly databases = new Map<string, { raw: Database; adapter: SqliteWasmDatabaseAdapter }>()

  constructor(private readonly sqlite3: Sqlite3Static) {}

  withWorkspaceLease<T>(operation: () => Promise<T>): Promise<T> {
    return operation()
  }

  async withDatabase<T>(
    filename: string,
    schemaSql: string,
    operation: (db: DatabaseAdapter) => T | Promise<T>
  ): Promise<T> {
    let entry = this.databases.get(filename)
    if (!entry) {
      const raw = new this.sqlite3.oo1.DB(':memory:', 'c')
      entry = { raw, adapter: new SqliteWasmDatabaseAdapter(this.sqlite3, raw) }
      entry.adapter.pragma('foreign_keys = ON')
      this.databases.set(filename, entry)
    }
    entry.adapter.exec(schemaSql)
    return operation(entry.adapter)
  }

  async deleteDatabase(filename: string): Promise<boolean> {
    const entry = this.databases.get(filename)
    if (!entry) return false
    entry.adapter.close()
    return this.databases.delete(filename)
  }

  async ensureCapacity(minimum: number): Promise<number> {
    return minimum
  }

  async getDatabaseFilenames(): Promise<string[]> {
    return [...this.databases.keys()]
  }

  dispose(): void {
    for (const entry of this.databases.values()) entry.adapter.close()
    this.databases.clear()
  }
}

describe('BrowserAIConversationRepository', () => {
  it('persists conversations and messages and cascades deletion', async () => {
    const sqlite3 = await sqlite3InitModule()
    const database = new MemoryWorkspaceDatabase(sqlite3)
    const repository = new BrowserAIConversationRepository(database)
    try {
      const conversation = await repository.createConversation('session-1', 'First')
      const firstMessage = await repository.appendMessage({
        conversationId: conversation.id,
        role: 'user',
        content: 'hello',
      })
      await repository.appendMessage({
        conversationId: conversation.id,
        role: 'assistant',
        content: 'world',
        usage: { totalTokens: 3 },
      })
      await repository.saveContextSummary({
        conversationId: conversation.id,
        content: 'Earlier context summary',
        boundaryMessageId: firstMessage.id,
        compressedMessageCount: 1,
      })
      assert.equal((await repository.listConversations('session-1')).length, 1)
      assert.deepEqual(
        (await repository.getMessages(conversation.id)).map((message) => [message.role, message.content]),
        [
          ['user', 'hello'],
          ['assistant', 'world'],
        ]
      )
      assert.equal((await repository.getContextSummary(conversation.id))?.content, 'Earlier context summary')
      assert.equal(await repository.deleteBySession('session-1'), 1)
      assert.equal(await repository.getConversation(conversation.id), null)
      assert.deepEqual(await repository.getMessages(conversation.id), [])
      assert.equal(await repository.getContextSummary(conversation.id), null)
    } finally {
      database.dispose()
    }
  })
})

describe('BrowserAIToolRuntime', () => {
  it('binds tools to one session, redacts sensitive fields and rejects raw SQL', async () => {
    const sqlite3 = await sqlite3InitModule()
    const database = new MemoryWorkspaceDatabase(sqlite3)
    const tools = new BrowserAIToolRuntime(database)
    try {
      await database.withDatabase('/chatlab-sessions/session-1.db', CHAT_DB_TABLES, (db) => {
        db.prepare(
          `INSERT INTO meta (name, platform, type, imported_at, owner_id)
           VALUES (?, ?, ?, ?, ?)`
        ).run('Safe Test', 'wechat', 'group', 1, 'alice')
        db.prepare(
          `INSERT INTO member (platform_id, account_name, group_nickname)
           VALUES (?, ?, ?)`
        ).run('alice', 'Alice', 'Alice')
        db.prepare(
          `INSERT INTO message (sender_id, sender_account_name, sender_group_nickname, ts, type, content)
           VALUES (1, ?, ?, 1, 0, ?)`
        ).run('Alice', 'Alice', '联系 13800138000，邮箱 alice@example.com，密钥 sk-secretabcdefghijklmnop')
      })

      const search = await tools.execute('session-1', 'search_messages', {
        keywords: ['联系'],
        limit: 10,
      })
      const serialized = JSON.stringify(search)
      assert.doesNotMatch(serialized, /13800138000|alice@example\.com|sk-secret/)
      assert.match(serialized, /<PHONE>|<EMAIL>|<API_KEY>/)

      const invalidSearch = await tools.execute('session-1', 'search_messages', { keywords: [] })
      assert.equal(invalidSearch.isError, true)
      assert.match(invalidSearch.content, /^Error:/)

      await assert.rejects(tools.execute('session-1', 'execute_sql', { sql: 'SELECT * FROM message' }), /not available/)
      const overview = await tools.execute('session-1', 'get_chat_overview', {})
      assert.match(overview.content, /Safe Test/)
      assert.deepEqual(
        tools.listTools().map((tool) => tool.name),
        [
          'get_chat_overview',
          'search_messages',
          'get_recent_messages',
          'get_message_context',
          'get_members',
          'get_member_stats',
          'get_time_stats',
          'get_conversation_between',
          'get_member_name_history',
        ]
      )
      const englishMetadata = JSON.stringify(tools.listTools('en-US'))
      const japaneseMetadata = JSON.stringify(tools.listTools('ja-JP'))
      assert.doesNotMatch(englishMetadata, /[\u3400-\u9fff]/)
      assert.doesNotMatch(japaneseMetadata, /[\u3400-\u9fff]/)
      assert.match(
        tools.listTools('zh-CN').find((tool) => tool.name === 'get_chat_overview')?.description ?? '',
        /聊天概览/
      )
      await assert.rejects(tools.execute('session-2', 'unknown_tool', {}), /not available/)
    } finally {
      database.dispose()
    }
  })
})
