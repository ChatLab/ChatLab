import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import Database from 'better-sqlite3'
import { MCP_TOOL_REGISTRY } from '@openchatlab/tools'
import { DatabaseManager, NodePathProvider, readDataDirCompatibilityMeta } from '@openchatlab/node-runtime'
import { registerTools } from './server'

test('advertises every ChatLab MCP query tool as read-only', async () => {
  const server = new McpServer({ name: 'chatlab-test', version: '0.0.0' })
  const client = new Client({ name: 'chatlab-test-client', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

  try {
    registerTools(server, { listSessionIdsReadonly: () => [], openReadonly: () => null })
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

test('MCP queries do not migrate a pending-schema session or raise the data compatibility gate', async (t) => {
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
      assert.equal(result.isError, undefined, `${name}: ${JSON.stringify(result.content)}`)
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
