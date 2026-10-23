import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CHAT_DB_TABLES } from '@openchatlab/core'
import { DatabaseManager, NodePathProvider } from '@openchatlab/node-runtime'
import { startMcpServer } from './server'

/** Full MCP protocol tests for the two trust boundaries identified in PR review. */
test('MCP confines session IDs to real ChatLab databases and rejects SQL prepare side effects', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-mcp-safety-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const dataDir = path.join(root, 'data')
  const dbDir = path.join(dataDir, 'databases')
  fs.mkdirSync(dbDir, { recursive: true })
  const dbPath = path.join(dbDir, 'valid.db')
  const db = new Database(dbPath)
  try {
    db.pragma('journal_mode=WAL')
    db.exec(CHAT_DB_TABLES)
    db.exec(`
      INSERT INTO meta(name, platform, type, imported_at)
      VALUES('Valid chat', 'qq', 'group', 1000);
      INSERT INTO member(platform_id, account_name) VALUES('p1', 'Alice');
      INSERT INTO message(sender_id, ts, type, content) VALUES(1, 1000, 0, 'allowed chat content');
    `)
  } finally {
    db.close()
  }

  const privateDbPath = path.join(dataDir, 'private.db')
  const privateDb = new Database(privateDbPath)
  try {
    privateDb.exec("CREATE TABLE secrets(value TEXT); INSERT INTO secrets VALUES('SYNTHETIC_OUTSIDE_SESSION_SECRET');")
  } finally {
    privateDb.close()
  }
  const foreignDbPath = path.join(dbDir, 'foreign.db')
  const foreignDb = new Database(foreignDbPath)
  try {
    foreignDb.exec("CREATE TABLE secrets(value TEXT); INSERT INTO secrets VALUES('NON_CHATLAB_SECRET');")
  } finally {
    foreignDb.close()
  }

  const manager = new DatabaseManager(new NodePathProvider(dataDir), {
    runtime: { version: '0.37.6', kind: 'mcp' },
  })
  manager.raiseCurrentChatDbCompatibilityGate()
  t.after(() => manager.closeAll())
  assert.deepEqual(manager.listSessionIdsMcpReadonly(), ['valid'])
  // File symlinks require elevated privilege on some Windows test runners.
  // Exercise the symlink boundary on POSIX; Windows-specific path checks still run.
  if (process.platform !== 'win32') fs.symlinkSync(privateDbPath, path.join(dbDir, 'linked.db'))
  const markerPath = path.join(dataDir, '.chatlab-meta.json')
  const beforeMarker = fs.readFileSync(markerPath)
  const beforeDb = fs.readFileSync(dbPath)

  const client = new Client({ name: 'mcp-safety-client', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const connect = McpServer.prototype.connect
  t.mock.method(McpServer.prototype, 'connect', function (this: McpServer) {
    t.after(() => this.close())
    return connect.call(this, serverTransport)
  })
  await startMcpServer({ version: '0.37.6', dbManager: manager })
  await client.connect(clientTransport)
  try {
    for (const sessionId of [
      '../private',
      '..\\private',
      'C:\\outside',
      '/tmp/outside',
      'name:stream',
      'bad\u0000id',
      '.',
      '..',
      'linked',
      'foreign',
    ]) {
      const result = await client.callTool({
        name: 'chatlab_execute_sql',
        arguments: { session_id: sessionId, sql: 'SELECT * FROM secrets', format: 'json' },
      })
      assert.equal(result.isError, true, `${JSON.stringify(sessionId)} escaped session boundary`)
      assert.doesNotMatch(JSON.stringify(result.content), /SYNTHETIC_OUTSIDE_SESSION_SECRET|NON_CHATLAB_SECRET/)
    }
    for (const uri of [
      'chatlab://sessions/..%2Fprivate/meta',
      'chatlab://sessions/..%5Cprivate/schema',
      'chatlab://sessions/linked/meta',
      'chatlab://sessions/foreign/schema',
    ]) {
      let body: string
      try {
        const result = await client.readResource({ uri })
        body = JSON.stringify(result.contents)
      } catch (error) {
        body = String(error)
      }
      assert.doesNotMatch(body, /SYNTHETIC_OUTSIDE_SESSION_SECRET|NON_CHATLAB_SECRET/, uri)
      assert.match(body, /Session not found|Invalid MCP session|Not a ChatLab|not found|Invalid Request/i, uri)
    }

    const check = async (sql: string) =>
      client.callTool({ name: 'chatlab_execute_sql', arguments: { session_id: 'valid', sql, format: 'json' } })
    // Query a second SQLite connection to prove that prepare() itself did not
    // change the process-global temp_store_directory setting.
    const probe = new Database(':memory:')
    const beforeTempDirectory = probe.pragma('temp_store_directory')
    try {
      const pragma = await check(`PRAGMA temp_store_directory='${root.replace(/'/g, "''")}' -- LIMIT`)
      assert.equal(pragma.isError, true)
      assert.match(JSON.stringify(pragma.content), /Only SELECT or WITH/i)
      assert.deepEqual(probe.pragma('temp_store_directory'), beforeTempDirectory)
    } finally {
      probe.close()
    }
    for (const sql of [
      'ATTACH DATABASE ":memory:" AS extra',
      'EXPLAIN PRAGMA temp_store_directory',
      'BEGIN',
      '/* comment */ PRAGMA writable_schema=ON',
    ]) {
      const result = await check(sql)
      assert.equal(result.isError, true, sql)
      assert.match(JSON.stringify(result.content), /Only SELECT or WITH/i, sql)
    }
    // WITH is allowed lexically, but SQLite's native readonly flag must
    // still reject DML hidden behind the CTE entry point.
    const withWrite = await check(
      "WITH c(x) AS (SELECT 1) UPDATE message SET content='TAMPERED' WHERE id IN (SELECT x FROM c)"
    )
    assert.match(JSON.stringify(withWrite.content), /read-only statements/i)

    const validSql = [
      'SELECT content FROM message',
      '-- comment\n SELECT content FROM message',
      '/* leading */\nWITH c(x) AS (SELECT 7) SELECT x FROM c',
    ]
    for (const sql of validSql) {
      const result = await check(sql)
      assert.equal(result.isError, undefined, `${sql}: ${JSON.stringify(result.content)}`)
    }
    assert.deepEqual(fs.readFileSync(dbPath), beforeDb)
    assert.deepEqual(fs.readFileSync(markerPath), beforeMarker)
    const other = new Database(privateDbPath, { readonly: true })
    try {
      assert.deepEqual(other.prepare('SELECT value FROM secrets').all(), [
        { value: 'SYNTHETIC_OUTSIDE_SESSION_SECRET' },
      ])
    } finally {
      other.close()
    }
  } finally {
    await client.close()
  }
})
