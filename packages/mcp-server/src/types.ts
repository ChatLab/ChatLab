/**
 * MCP Server public types
 */

import type { DatabaseAdapter } from '@openchatlab/core'

/**
 * Minimal database manager interface for MCP Server.
 * Both CLI's DatabaseManager and Desktop's helper can satisfy this contract.
 */
export interface McpDatabaseManager {
  /** List chat sessions without running schema migrations. */
  listSessionIdsReadonly(): string[]
  /** Open a non-cached, strictly read-only connection; caller must close it. */
  openReadonly(sessionId: string): DatabaseAdapter | null
}

export interface McpServerOptions {
  version: string
  /** MCP server name exposed to clients (default: 'chatlab') */
  name?: string
  dbManager: McpDatabaseManager
  /** Locale deciding whether tool descriptions are Chinese or English (default: English) */
  locale?: string
}
