import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CURRENT_SCHEMA_VERSION } from '@openchatlab/core'
import { DatabaseManager, NodePathProvider, readDataDirCompatibilityMeta } from '@openchatlab/node-runtime'
import { startMcpServer } from './server'
import { openTestSqliteDatabase } from '../../../tests/helpers/sqlite.mts'

test('real MCP tools and resources reject a released schema-v4 database until a writable upgrade', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-mcp-v4-preflight-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const dataDir = path.join(root, 'data')
  const dbDir = path.join(dataDir, 'databases')
  fs.mkdirSync(dbDir, { recursive: true })
  const dbPath = path.join(dbDir, 'legacy-v4.db')

  // Matches the published v4 member.name/nickname layout covered by
  // database-manager.test.ts, rather than a new-schema fixture with a v4 tag.
  const fixture = openTestSqliteDatabase(dbPath)
  try {
    fixture.exec(`
      CREATE TABLE meta (
        name TEXT NOT NULL, platform TEXT NOT NULL, type TEXT NOT NULL,
        imported_at INTEGER NOT NULL, schema_version INTEGER DEFAULT 4
      );
      INSERT INTO meta (name, platform, type, imported_at, schema_version)
      VALUES ('Old Chat', 'qq', 'group', 1000, 4);
      CREATE TABLE member (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, nickname TEXT
      );
      INSERT INTO member (platform_id, name, nickname)
      VALUES ('u1', 'Alice Account', 'Alice Group');
      CREATE TABLE message (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER NOT NULL, ts INTEGER NOT NULL, type INTEGER NOT NULL, content TEXT
      );
      INSERT INTO message (sender_id, ts, type, content) VALUES (1, 1000, 0, 'hello');
      CREATE TABLE chat_session (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        start_ts INTEGER NOT NULL, end_ts INTEGER NOT NULL,
        message_count INTEGER DEFAULT 0, is_manual INTEGER DEFAULT 0, summary TEXT
      );
      CREATE TABLE message_context (
        message_id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL, topic_id INTEGER
      );
    `)
  } finally {
    fixture.close()
  }

  const beforeDb = fs.readFileSync(dbPath)
  const markerPath = path.join(dataDir, '.chatlab-meta.json')
  assert.equal(readDataDirCompatibilityMeta(dataDir), null)

  const dbManager = new DatabaseManager(new NodePathProvider(dataDir), {
    runtime: { version: '0.37.6', kind: 'mcp' },
  })
  t.after(() => dbManager.closeAll())

  // The shared read-only API is also used by CLI auto-import analysis. It must
  // continue to discover genuine v4 sessions without requiring MCP's v10 schema.
  assert.deepEqual(dbManager.listSessionIdsReadonly(), ['legacy-v4'])
  const sharedDb = dbManager.openReadonly('legacy-v4')
  assert.ok(sharedDb)
  assert.equal(sharedDb.readonly, true)
  sharedDb.close()
  assert.deepEqual(fs.readFileSync(dbPath), beforeDb)
  assert.equal(fs.existsSync(markerPath), false)

  const client = new Client({ name: 'legacy-schema-test-client', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  // Exercise the actual registration and resource callbacks, substituting only
  // in-memory transport for stdio as in the protocol contract test above.
  const connect = McpServer.prototype.connect
  t.mock.method(McpServer.prototype, 'connect', function (this: McpServer) {
    t.after(() => this.close())
    return connect.call(this, serverTransport)
  })
  await startMcpServer({ version: '0.37.6', dbManager })
  await client.connect(clientTransport)
  try {
    for (const [name, args] of [
      ['chatlab_list_sessions', {}],
      ['chatlab_get_session_info', { session_id: 'legacy-v4' }],
      ['chatlab_get_recent_messages', { session_id: 'legacy-v4' }],
      ['chatlab_execute_sql', { session_id: 'legacy-v4', sql: 'SELECT 1' }],
    ] as const) {
      const result = await client.callTool({ name, arguments: { ...args, format: 'json' } })
      assert.equal(result.isError, true, `${name} should require a schema upgrade`)
      assert.match(JSON.stringify(result.content), /schema v4.*schema v10.*migrate/i)
    }
    for (const uri of [
      'chatlab://sessions',
      'chatlab://sessions/legacy-v4/meta',
      'chatlab://sessions/legacy-v4/schema',
    ]) {
      await assert.rejects(client.readResource({ uri }), /schema v4.*schema v10.*migrate/i, uri)
    }
    assert.deepEqual(fs.readFileSync(dbPath), beforeDb)
    assert.equal(fs.existsSync(markerPath), false, 'MCP must not repair the compatibility marker')

    // This explicit writable operation is intentionally outside MCP dispatch.
    const migrated = dbManager.open('legacy-v4')
    assert.ok(migrated)
    assert.equal(
      (migrated.prepare('SELECT schema_version FROM meta').get() as { schema_version: number }).schema_version,
      CURRENT_SCHEMA_VERSION
    )
    dbManager.close('legacy-v4')
    const afterUpgrade = fs.readFileSync(dbPath)
    const repairedMarker = fs.readFileSync(markerPath)

    const list = await client.callTool({ name: 'chatlab_list_sessions', arguments: { format: 'json' } })
    assert.equal(list.isError, undefined, JSON.stringify(list.content))
    assert.match(JSON.stringify(list.content), /Old Chat/)
    const info = await client.callTool({
      name: 'chatlab_get_session_info',
      arguments: { session_id: 'legacy-v4', format: 'json' },
    })
    assert.equal(info.isError, undefined, JSON.stringify(info.content))

    const listResource = await client.readResource({ uri: 'chatlab://sessions' })
    assert.match(JSON.stringify(listResource.contents), /Old Chat/)
    const metaResource = await client.readResource({ uri: 'chatlab://sessions/legacy-v4/meta' })
    assert.match(JSON.stringify(metaResource.contents), /Old Chat/)
    const schemaResource = await client.readResource({ uri: 'chatlab://sessions/legacy-v4/schema' })
    assert.match(JSON.stringify(schemaResource.contents), /member/)
    assert.deepEqual(fs.readFileSync(dbPath), afterUpgrade)
    assert.deepEqual(fs.readFileSync(markerPath), repairedMarker)
  } finally {
    await client.close()
  }
})

test('MCP tools and resources refuse invalid SQLite schema versions before SQL dispatch', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-mcp-invalid-schema-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const dataDir = path.join(root, 'data')
  const dbDir = path.join(dataDir, 'databases')
  fs.mkdirSync(dbDir, { recursive: true })
  const dbPath = path.join(dbDir, 'invalid-version.db')
  const fixture = openTestSqliteDatabase(dbPath)
  try {
    fixture.exec(`
      CREATE TABLE meta (
        name TEXT, platform TEXT, type TEXT, imported_at INTEGER, schema_version INTEGER
      );
      INSERT INTO meta VALUES ('Legacy', 'qq', 'group', 1000, 'not-a-version');
      CREATE TABLE member (id INTEGER, platform_id TEXT, name TEXT, nickname TEXT);
      INSERT INTO member VALUES (1, 'legacy-user', 'Alice', 'Alice Group');
      CREATE TABLE message (id INTEGER, sender_id INTEGER, ts INTEGER, type INTEGER, content TEXT);
      INSERT INTO message VALUES (1, 1, 1000, 0, 'legacy message');
    `)
    const actual = fixture.prepare('SELECT schema_version, typeof(schema_version) AS storage FROM meta').get() as {
      schema_version: unknown
      storage: string
    }
    assert.equal(actual.schema_version, 'not-a-version')
    assert.equal(actual.storage, 'text')
  } finally {
    fixture.close()
  }

  const originalDb = fs.readFileSync(dbPath)
  const markerPath = path.join(dataDir, '.chatlab-meta.json')
  assert.equal(readDataDirCompatibilityMeta(dataDir), null)

  const dbManager = new DatabaseManager(new NodePathProvider(dataDir), {
    runtime: { version: '0.37.6', kind: 'mcp' },
  })
  t.after(() => dbManager.closeAll())
  // CLI import analysis must retain read-only access to older/unrecognized
  // schema candidates, without silently applying MCP's stricter rule.
  assert.deepEqual(dbManager.listSessionIdsReadonly(), ['invalid-version'])
  const sharedDb = dbManager.openReadonly('invalid-version')
  assert.ok(sharedDb)
  assert.equal(sharedDb.readonly, true)
  sharedDb.close()

  const client = new Client({ name: 'invalid-schema-test-client', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const connect = McpServer.prototype.connect
  t.mock.method(McpServer.prototype, 'connect', function (this: McpServer) {
    t.after(() => this.close())
    return connect.call(this, serverTransport)
  })
  await startMcpServer({ version: '0.37.6', dbManager })
  await client.connect(clientTransport)
  try {
    for (const [name, args] of [
      ['chatlab_list_sessions', {}],
      ['chatlab_execute_sql', { session_id: 'invalid-version', sql: 'SELECT 1 AS ok' }],
      ['chatlab_get_session_info', { session_id: 'invalid-version' }],
      ['chatlab_get_schema', { session_id: 'invalid-version' }],
    ] as const) {
      const result = await client.callTool({ name, arguments: { ...args, format: 'json' } })
      assert.equal(result.isError, true, `${name} incorrectly accepted an invalid schema version`)
      assert.match(JSON.stringify(result.content), /invalid schema version/i, name)
      assert.doesNotMatch(JSON.stringify(result.content), /no such column/i, name)
    }

    for (const uri of [
      'chatlab://sessions',
      'chatlab://sessions/invalid-version/meta',
      'chatlab://sessions/invalid-version/schema',
    ]) {
      await assert.rejects(client.readResource({ uri }), /invalid schema version/i, uri)
    }
    assert.deepEqual(fs.readFileSync(dbPath), originalDb)
    assert.equal(fs.existsSync(markerPath), false)
  } finally {
    await client.close()
  }
})
