/**
 * MCP Server public types
 */

import type { DatabaseAdapter } from '@openchatlab/core'

/**
 * Minimal database manager interface for MCP Server.
 * Both CLI's DatabaseManager and Desktop's helper can satisfy this contract.
 */
export interface McpDatabaseManager {
  listSessionIds(): string[]
  open(sessionId: string): DatabaseAdapter | null
}

export interface McpServerOptions {
  version: string
  /** MCP server name exposed to clients (default: 'chatlab') */
  name?: string
  dbManager: McpDatabaseManager
}
