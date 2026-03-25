/**
 * MCP tools registry - aggregates all tool registration functions
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerSessionTools } from './session.js'
import { registerMemberTools } from './members.js'
import { registerMessageTools } from './messages.js'
import { registerStatsTools } from './stats.js'
import { registerSqlTools } from './sql.js'
import { registerNlpTools } from './nlp.js'

/**
 * Register all MCP tools on the server
 */
export function registerAllTools(server: McpServer): void {
  registerSessionTools(server)
  registerMemberTools(server)
  registerMessageTools(server)
  registerStatsTools(server)
  registerSqlTools(server)
  registerNlpTools(server)
}
