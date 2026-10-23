/**
 * MCP Server public types
 */

import type { DatabaseAdapter } from '@openchatlab/core'

/**
 * Minimal database manager interface for MCP Server.
 * Both CLI's DatabaseManager and Desktop's helper can satisfy this contract.
 */
export interface McpDatabaseManager {
  /** List only MCP-supported chat sessions; reject any requiring an upgrade. */
  listSessionIdsMcpReadonly(): string[]
  /** Open a non-cached, strictly read-only MCP connection after schema preflight; caller closes it. */
  openMcpReadonly(sessionId: string): DatabaseAdapter | null
}

export interface McpServerOptions {
  version: string
  /** MCP server name exposed to clients (default: 'chatlab') */
  name?: string
  dbManager: McpDatabaseManager
  /** Locale deciding whether tool descriptions are Chinese or English (default: English) */
  locale?: string
}
