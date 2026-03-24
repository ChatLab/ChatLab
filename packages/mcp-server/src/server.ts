/**
 * MCP Server factory
 * Creates and configures the McpServer instance with all tools registered
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerAllTools } from './tools/index.js'

/**
 * Create a configured MCP Server instance
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: 'ChatLab',
    version: '0.1.0',
  })

  registerAllTools(server)

  return server
}
