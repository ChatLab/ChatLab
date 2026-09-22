/**
 * chatlab-mcp
 *
 * Shared MCP Server core for CLI and Desktop helper.
 * Registers ChatLab tools and resources over stdio transport.
 */

export { startMcpServer } from './server'
export { resolveMcpLocale } from './standalone-runtime'
export type { McpServerOptions, McpDatabaseManager } from './types'
