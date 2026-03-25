/**
 * MCP Server factory
 * Creates and configures the McpServer instance with all tools and resources
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerAllTools } from './tools/index.js'
import { listSessions, openDatabase } from './db.js'
import * as queries from './queries.js'

/**
 * Create a configured MCP Server instance
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: 'ChatLab',
    version: '0.1.0',
  })

  // Register tools
  registerAllTools(server)

  // Register resources
  registerResources(server)

  return server
}

/**
 * Register MCP Resources
 */
function registerResources(server: McpServer): void {
  // Static resource: all sessions
  server.resource(
    'sessions',
    'chatlab://sessions',
    { description: 'List of all available chat sessions with metadata' },
    async (uri) => {
      const sessions = listSessions()
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(sessions, null, 2),
        }],
      }
    }
  )

  // Dynamic resource: session members
  server.resource(
    'session-members',
    new ResourceTemplate('chatlab://sessions/{sessionId}/members', { list: undefined }),
    { description: 'Members of a specific chat session' },
    async (uri, { sessionId }) => {
      const db = openDatabase(sessionId as string)
      if (!db) throw new Error(`Session "${sessionId}" not found`)
      const members = queries.getMembers(db)
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(members, null, 2),
        }],
      }
    }
  )

  // Dynamic resource: session schema
  server.resource(
    'session-schema',
    new ResourceTemplate('chatlab://sessions/{sessionId}/schema', { list: undefined }),
    { description: 'Database table structure for a chat session' },
    async (uri, { sessionId }) => {
      const db = openDatabase(sessionId as string)
      if (!db) throw new Error(`Session "${sessionId}" not found`)
      const schema = queries.getSchema(db)
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(schema, null, 2),
        }],
      }
    }
  )
}
