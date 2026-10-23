import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import Database from 'better-sqlite3'
import { CHAT_DB_TABLES } from '@openchatlab/core'
import { MCP_TOOL_REGISTRY } from '@openchatlab/tools'
import {
  DatabaseManager,
  NodePathProvider,
  raiseDataDirMinRuntimeVersion,
  readDataDirCompatibilityMeta,
} from '@openchatlab/node-runtime'
import { registerTools } from './server'

test('advertises logical ChatLab MCP queries as read-only', async () => {
  const server = new McpServer({ name: 'chatlab-test', version: '0.0.0' })
  const client = new Client({ name: 'chatlab-test-client', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

  try {
    registerTools(server, { listSessionIdsMcpReadonly: () => [], openMcpReadonly: () => null })
    await server.connect(serverTransport)
    await client.connect(clientTransport)

    const { tools } = await client.listTools()
    assert.deepEqual(
      tools.map((tool) => tool.name).sort(),
      MCP_TOOL_REGISTRY.map((tool) => `chatlab_${tool.name}`).sort()
    )
    for (const tool of tools) {
      assert.deepEqual(
        tool.annotations,
        {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
        tool.name
      )
    }
  } finally {
    await client.close()
    await server.close()
  }
})

test('rejects unsafe raw MCP SQL before opening a database', async () => {
  const server = new McpServer({ name: 'chatlab-sql-precheck', version: '0.0.0' })
  const client = new Client({ name: 'chatlab-sql-precheck-client', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  let databaseOpenCalls = 0

  try {
    registerTools(server, {
      listSessionIdsMcpReadonly: () => [],
      openMcpReadonly: () => {
        databaseOpenCalls++
        throw new Error('Unsafe SQL should never open a database')
      },
    })
    await server.connect(serverTransport)
    await client.connect(clientTransport)

    const result = await client.callTool({
      name: 'chatlab_execute_sql',
      arguments: { session_id: 'missing', sql: "PRAGMA temp_store_directory='/tmp'" },
    })
    assert.equal(result.isError, true)
    assert.match(JSON.stringify(result.content), /Only SELECT or WITH queries/i)
    assert.equal(databaseOpenCalls, 0)
  } finally {
    await client.close()
    await server.close()
  }
})

test('MCP rejects schema v5 before dispatch without migrating or raising the compatibility gate', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-mcp-readonly-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  const dataDir = path.join(root, 'data')
  const dbDir = path.join(dataDir, 'databases')
  fs.mkdirSync(dbDir, { recursive: true })
  const dbPath = path.join(dbDir, 'legacy.db')

  // Version 5 predates the v6 migration that can raise the compatibility gate.
  const fixture = new Database(dbPath)
  try {
    fixture.exec(`
      CREATE TABLE meta (
        name TEXT NOT NULL,
        platform TEXT NOT NULL,
        type TEXT NOT NULL,
        imported_at INTEGER NOT NULL,
        schema_version INTEGER DEFAULT 5
      );
      INSERT INTO meta (name, platform, type, imported_at, schema_version)
      VALUES ('Legacy chat', 'qq', 'group', 1000, 5);

      CREATE TABLE member (
        id INTEGER PRIMARY KEY,
        platform_id TEXT NOT NULL UNIQUE,
        account_name TEXT
      );
      INSERT INTO member (id, platform_id, account_name) VALUES (1, 'legacy-user', 'Alice');

      CREATE TABLE message (
        id INTEGER PRIMARY KEY,
        sender_id INTEGER NOT NULL,
        ts INTEGER NOT NULL,
        type INTEGER NOT NULL,
        content TEXT
      );
      INSERT INTO message (id, sender_id, ts, type, content)
      VALUES (1, 1, 1000, 0, 'hello from legacy schema');
    `)
  } finally {
    fixture.close()
  }
  const initialDatabase = fs.readFileSync(dbPath)
  assert.equal(readDataDirCompatibilityMeta(dataDir), null)

  const dbManager = new DatabaseManager(new NodePathProvider(dataDir), {
    runtime: { version: '0.37.6', kind: 'mcp' },
  })
  t.after(() => dbManager.closeAll())

  const server = new McpServer({ name: 'chatlab-test', version: '0.37.6' })
  const client = new Client({ name: 'chatlab-test-client', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

  try {
    registerTools(server, dbManager)
    await server.connect(serverTransport)
    await client.connect(clientTransport)

    for (const [name, args] of [
      ['chatlab_list_sessions', {}],
      ['chatlab_get_schema', { session_id: 'legacy' }],
      ['chatlab_get_session_info', { session_id: 'legacy' }],
      ['chatlab_execute_sql', { session_id: 'legacy', sql: 'SELECT content FROM message' }],
    ] as const) {
      const result = await client.callTool({ name, arguments: { ...args, format: 'json' } })
      assert.equal(result.isError, true, `${name} should require an explicit upgrade`)
      assert.match(JSON.stringify(result.content), /schema v5.*schema v10.*migrate/i)
      assert.equal(readDataDirCompatibilityMeta(dataDir), null, `${name} raised the compatibility gate`)
      assert.deepEqual(fs.readFileSync(dbPath), initialDatabase, `${name} modified the legacy database`)
    }
  } finally {
    await client.close()
    await server.close()
  }

  const after = new Database(dbPath, { readonly: true })
  try {
    const version = after.prepare('SELECT schema_version FROM meta').get() as { schema_version: number }
    assert.equal(version.schema_version, 5)
    assert.equal(after.prepare("SELECT name FROM sqlite_master WHERE name = 'segment'").get(), undefined)
  } finally {
    after.close()
  }
})

test('MCP requires an explicit v9 upgrade and preserves current v10 summary results', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-mcp-v9-summaries-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const dataDir = path.join(root, 'data')
  const dbDir = path.join(dataDir, 'databases')
  fs.mkdirSync(dbDir, { recursive: true })

  const legacyPath = path.join(dbDir, 'v9.db')
  const legacyDb = new Database(legacyPath)
  try {
    legacyDb.exec(`
      CREATE TABLE meta (
        name TEXT NOT NULL, platform TEXT NOT NULL, type TEXT NOT NULL,
        imported_at INTEGER NOT NULL, schema_version INTEGER DEFAULT 9
      );
      INSERT INTO meta (name, platform, type, imported_at, schema_version)
      VALUES ('v9 chat', 'qq', 'group', 1000, 9);
      CREATE TABLE member (id INTEGER PRIMARY KEY, platform_id TEXT UNIQUE, account_name TEXT);
      INSERT INTO member VALUES (1, 'legacy-user', 'Alice');
      CREATE TABLE message (id INTEGER PRIMARY KEY, sender_id INTEGER, ts INTEGER, type INTEGER, content TEXT);
      INSERT INTO message VALUES (1, 1, 1000, 0, 'hello');
      CREATE TABLE segment (
        id INTEGER PRIMARY KEY, start_ts INTEGER, end_ts INTEGER,
        message_count INTEGER, summary TEXT
      );
      INSERT INTO segment VALUES (1, 1000, 1000, 1, 'Old unverified summary');
      CREATE TABLE message_context (message_id INTEGER PRIMARY KEY, segment_id INTEGER, topic_id INTEGER);
      INSERT INTO message_context VALUES (1, 1, NULL);
    `)
  } finally {
    legacyDb.close()
  }

  const currentPath = path.join(dbDir, 'v10.db')
  const currentDb = new Database(currentPath)
  try {
    currentDb.exec(CHAT_DB_TABLES)
    currentDb.exec(`
      INSERT INTO meta (name, platform, type, imported_at)
      VALUES ('v10 chat', 'qq', 'group', 1000);
      INSERT INTO member (id, platform_id, account_name) VALUES (1, 'new-user', 'Bob');
      INSERT INTO message (id, sender_id, ts, type, content) VALUES (1, 1, 1000, 0, 'hello');
      INSERT INTO segment (id, start_ts, end_ts, message_count, summary, summary_message_count)
      VALUES (1, 1000, 1000, 1, 'Verified summary', 1);
      INSERT INTO message_context (message_id, segment_id, topic_id) VALUES (1, 1, NULL);
    `)
  } finally {
    currentDb.close()
  }

  const pathProvider = new NodePathProvider(dataDir)
  // Schema v9 has crossed the compatibility-gate boundary at v6. A writable
  // runtime must have repaired this metadata before read-only MCP access.
  raiseDataDirMinRuntimeVersion(pathProvider, {
    minRuntimeVersion: '0.25.1',
    dataCompatibilityVersion: 1,
    reason: 'segment-schema',
    runtime: { version: '0.37.6', kind: 'desktop' },
    module: 'test-fixture',
  })
  const beforeV9 = fs.readFileSync(legacyPath)
  const beforeV10 = fs.readFileSync(currentPath)
  const beforeGate = fs.readFileSync(path.join(dataDir, '.chatlab-meta.json'))

  const dbManager = new DatabaseManager(pathProvider, {
    runtime: { version: '0.37.6', kind: 'mcp' },
  })
  t.after(() => dbManager.closeAll())
  const server = new McpServer({ name: 'chatlab-test', version: '0.37.6' })
  const client = new Client({ name: 'chatlab-test-client', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

  try {
    registerTools(server, dbManager)
    await server.connect(serverTransport)
    await client.connect(clientTransport)

    const oldResult = await client.callTool({
      name: 'chatlab_get_segment_summaries',
      arguments: { session_id: 'v9', format: 'json' },
    })
    assert.equal(oldResult.isError, true, JSON.stringify(oldResult.content))
    assert.match(JSON.stringify(oldResult.content), /schema v9.*schema v10.*migrate/i)
    assert.deepEqual(fs.readFileSync(legacyPath), beforeV9)
    assert.deepEqual(fs.readFileSync(path.join(dataDir, '.chatlab-meta.json')), beforeGate)

    const currentResult = await client.callTool({
      name: 'chatlab_get_segment_summaries',
      arguments: { session_id: 'v10', format: 'json' },
    })
    assert.equal(currentResult.isError, undefined, JSON.stringify(currentResult.content))
    const parsed = JSON.parse((currentResult.content as Array<{ text: string }>)[0].text)
    assert.equal(parsed.total, 1)
    assert.equal(parsed.segments[0].summary, 'Verified summary')
    assert.deepEqual(parsed.segments[0].participants, ['Bob'])
    assert.deepEqual(fs.readFileSync(currentPath), beforeV10)
    assert.deepEqual(fs.readFileSync(path.join(dataDir, '.chatlab-meta.json')), beforeGate)
  } finally {
    await client.close()
    await server.close()
  }

  const verifyLegacy = new Database(legacyPath, { readonly: true })
  try {
    assert.equal(
      (verifyLegacy.prepare('SELECT schema_version FROM meta').get() as { schema_version: number }).schema_version,
      9
    )
    assert.equal(
      verifyLegacy.prepare("SELECT name FROM pragma_table_info('segment') WHERE name='summary_message_count'").get(),
      undefined
    )
  } finally {
    verifyLegacy.close()
  }
})

test('read-only MCP rejects schema v6 without a repaired compatibility gate', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-mcp-missing-gate-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const dataDir = path.join(root, 'data')
  const dbDir = path.join(dataDir, 'databases')
  fs.mkdirSync(dbDir, { recursive: true })
  const dbPath = path.join(dbDir, 'v6.db')
  const fixture = new Database(dbPath)
  try {
    fixture.exec(`
      CREATE TABLE meta (
        name TEXT NOT NULL, platform TEXT NOT NULL, type TEXT NOT NULL,
        imported_at INTEGER NOT NULL, schema_version INTEGER DEFAULT 6
      );
      INSERT INTO meta (name, platform, type, imported_at, schema_version)
      VALUES ('v6 chat', 'qq', 'group', 1000, 6);
      CREATE TABLE member (id INTEGER PRIMARY KEY, platform_id TEXT UNIQUE, account_name TEXT);
      CREATE TABLE message (id INTEGER PRIMARY KEY, sender_id INTEGER, ts INTEGER, type INTEGER, content TEXT);
    `)
  } finally {
    fixture.close()
  }
  const beforeDb = fs.readFileSync(dbPath)
  assert.equal(readDataDirCompatibilityMeta(dataDir), null)

  const pathProvider = new NodePathProvider(dataDir)
  const manager = new DatabaseManager(pathProvider, { runtime: { version: '0.37.6', kind: 'mcp' } })
  t.after(() => manager.closeAll())
  const server = new McpServer({ name: 'chatlab-test', version: '0.37.6' })
  const client = new Client({ name: 'chatlab-test-client', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  try {
    registerTools(server, manager)
    await server.connect(serverTransport)
    await client.connect(clientTransport)

    for (const [name, args] of [
      ['chatlab_list_sessions', {}],
      ['chatlab_get_session_info', { session_id: 'v6' }],
      ['chatlab_get_schema', { session_id: 'v6' }],
      ['chatlab_execute_sql', { session_id: 'v6', sql: 'SELECT 1' }],
    ] as const) {
      const result = await client.callTool({ name, arguments: { ...args, format: 'json' } })
      assert.equal(result.isError, true, `${name} should reject unrepaired metadata`)
      assert.match(JSON.stringify(result.content), /current writable ChatLab runtime/i)
      assert.equal(readDataDirCompatibilityMeta(dataDir), null)
      assert.deepEqual(fs.readFileSync(dbPath), beforeDb, `${name} changed the database`)
    }

    // Merely having metadata is insufficient: the marker must include the
    // migration's minimum version, compatibility level and reason.
    raiseDataDirMinRuntimeVersion(pathProvider, {
      minRuntimeVersion: '0.24.0',
      dataCompatibilityVersion: 0,
      reason: 'unrelated',
      runtime: { version: '0.37.6', kind: 'desktop' },
      module: 'test-fixture',
    })
    const inadequateGate = fs.readFileSync(path.join(dataDir, '.chatlab-meta.json'))
    const inadequateResult = await client.callTool({
      name: 'chatlab_get_schema',
      arguments: { session_id: 'v6', format: 'json' },
    })
    assert.equal(inadequateResult.isError, true)
    assert.match(JSON.stringify(inadequateResult.content), /current writable ChatLab runtime/i)
    assert.deepEqual(fs.readFileSync(path.join(dataDir, '.chatlab-meta.json')), inadequateGate)
    assert.deepEqual(fs.readFileSync(dbPath), beforeDb)

    // The writable runtime is responsible for repairing this marker separately.
    raiseDataDirMinRuntimeVersion(pathProvider, {
      minRuntimeVersion: '0.25.1',
      dataCompatibilityVersion: 1,
      reason: 'segment-schema',
      runtime: { version: '0.37.6', kind: 'desktop' },
      module: 'test-fixture',
    })
    const gateAfterRepair = fs.readFileSync(path.join(dataDir, '.chatlab-meta.json'))
    const result = await client.callTool({
      name: 'chatlab_get_session_info',
      arguments: { session_id: 'v6', format: 'json' },
    })
    assert.equal(result.isError, true, JSON.stringify(result.content))
    assert.match(JSON.stringify(result.content), /schema v6.*schema v10.*migrate/i)
    assert.deepEqual(fs.readFileSync(dbPath), beforeDb)
    assert.deepEqual(fs.readFileSync(path.join(dataDir, '.chatlab-meta.json')), gateAfterRepair)
  } finally {
    await client.close()
    await server.close()
  }
})
