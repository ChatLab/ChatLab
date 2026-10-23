import assert from 'node:assert/strict'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { MCP_TOOL_REGISTRY } from '@openchatlab/tools'
import { registerTools } from './server'

test('advertises every ChatLab MCP query tool as read-only', async () => {
  const server = new McpServer({ name: 'chatlab-test', version: '0.0.0' })
  const client = new Client({ name: 'chatlab-test-client', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

  try {
    registerTools(server, { listSessionIds: () => [], open: () => null })
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
