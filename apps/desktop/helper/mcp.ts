/**
 * Desktop MCP Helper entry point
 *
 * Standalone stdio MCP server that shares the same data directory as
 * the desktop app. Intended to be invoked by MCP clients (Claude Desktop,
 * Cursor, etc.) without launching the GUI.
 *
 * Dev usage:
 *   pnpm --filter @openchatlab/desktop run mcp
 */

import { loadConfig } from '@openchatlab/config'
import { NodePathProvider, DatabaseManager } from '@openchatlab/node-runtime'
import { startMcpServer } from 'chatlab-mcp'

const config = loadConfig()
const userDataDir = config.data.user_data_dir || undefined
const pathProvider = new NodePathProvider(userDataDir)
pathProvider.ensureAllDirs()
const dbManager = new DatabaseManager(pathProvider)

const version = process.env.npm_package_version ?? '0.0.0-dev'

startMcpServer({ version, dbManager })
