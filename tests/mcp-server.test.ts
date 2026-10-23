import assert from 'node:assert/strict'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CHAT_DB_TABLES } from '@openchatlab/core/src/schema/tables'
import { SqliteTestAdapter } from '@openchatlab/core/src/query/__tests__/sqlite-test-adapter'
import { startMcpServer } from '../packages/mcp-server/src/server'
import { openTestSqliteDatabase } from './helpers/sqlite.mts'

test('MCP tools/list array schemas agree with tools/call validation and database results', async (t) => {
  const db = new SqliteTestAdapter(openTestSqliteDatabase())
  const client = new Client({ name: 'schema-regression-test', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  t.after(async () => {
    await client.close()
    db.close()
  })

  // Keep production registration and handlers; replace only the stdio transport.
  const connect = McpServer.prototype.connect
  t.mock.method(McpServer.prototype, 'connect', function (this: McpServer) {
    t.after(() => this.close())
    return connect.call(this, serverTransport)
  })

  db.exec(CHAT_DB_TABLES)
  db.exec(`
    INSERT INTO member (id, platform_id, account_name) VALUES (1, 'alice', 'Alice');
    INSERT INTO message (id, sender_id, ts, type, content) VALUES
      (1, 1, 100, 0, 'alpha topic'),
      (2, 1, 200, 0, 'first neighbor'),
      (3, 1, 300, 0, 'unrelated topic'),
      (4, 1, 400, 0, 'second neighbor'),
      (5, 1, 500, 0, 'beta topic');
  `)
  // The production MCP server closes each read-only handle after a tool call.
  // Reuse this in-memory fixture without closing its underlying test database.
  const readonlyFixture = Object.create(db) as typeof db
  readonlyFixture.close = () => {}
  await startMcpServer({
    version: '1.0.0',
    dbManager: {
      listSessionIdsReadonly: () => ['fixture'],
      openReadonly: (id) => (id === 'fixture' ? readonlyFixture : null),
    },
  })
  await client.connect(clientTransport)
  const { tools } = await client.listTools()

  for (const { name, parameter, itemType, value, options, invalid } of [
    {
      name: 'chatlab_search_messages',
      parameter: 'keywords',
      itemType: 'string',
      value: ['alpha', 'beta'],
      options: { limit: 2 },
      invalid: ['alpha', [1], ['alpha', false]],
    },
    {
      name: 'chatlab_deep_search_messages',
      parameter: 'keywords',
      itemType: 'string',
      value: ['alpha', 'beta'],
      options: { limit: 2 },
      invalid: ['alpha', [1], ['alpha', false]],
    },
    {
      name: 'chatlab_get_message_context',
      parameter: 'message_ids',
      itemType: 'number',
      value: [1, 5],
      options: { context_size: 0 },
      invalid: ['1', ['1'], [1, '5']],
    },
  ]) {
    await t.test(name, async () => {
      const tool = tools.find((tool) => tool.name === name)
      assert.ok(tool)
      assert.ok(tool.inputSchema.required?.includes(parameter))
      assert.ok(tool.inputSchema.required?.includes('session_id'))
      const property = tool.inputSchema.properties?.[parameter] as { type: string; items: { type: string } }
      assert.equal(property.type, 'array')
      assert.deepEqual(property.items, { type: itemType })

      const args = { session_id: 'fixture', format: 'json', ...options }
      const result = await client.callTool({ name, arguments: { ...args, [parameter]: value } })
      assert.ok(!result.isError, JSON.stringify(result))
      assert.ok(Array.isArray(result.content))
      const content = result.content[0]
      assert.equal(content.type, 'text')
      const data = JSON.parse(content.text as string)
      assert.deepEqual(
        data.rawMessages.map((message: { id: number }) => message.id).sort((a: number, b: number) => a - b),
        [1, 5]
      )
      assert.deepEqual(data.rawMessages.map((message: { content: string }) => message.content).sort(), [
        'alpha topic',
        'beta topic',
      ])
      if (parameter === 'message_ids') {
        assert.deepEqual(data.requestedMessageIds, value)
      } else {
        assert.equal(data.total, 2)
      }

      for (const value of [undefined, ...invalid]) {
        const result = await client.callTool({ name, arguments: { ...args, [parameter]: value } })
        assert.equal(result.isError, true)
      }
    })
  }
})
