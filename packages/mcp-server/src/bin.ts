#!/usr/bin/env node

/**
 * Standalone MCP Server entry for `npx -y chatlab-mcp`
 *
 * Initializes runtime (config, paths, database) and starts the MCP server.
 * All logs go to stderr; stdout is reserved for MCP protocol communication.
 */

import { loadConfig } from '@openchatlab/config'
import { NodePathProvider, DatabaseManager } from '@openchatlab/node-runtime'
import { startMcpServer } from './server'
import { getMcpPackageVersion } from './runtime-version'

function main(): void {
  const config = loadConfig()
  const userDataDir = config.data.user_data_dir || undefined
  const pathProvider = new NodePathProvider(userDataDir)
  pathProvider.ensureAllDirs()
  const version = getMcpPackageVersion()
  const dbManager = new DatabaseManager(pathProvider, { runtime: { version, kind: 'mcp' } })

  startMcpServer({ version, dbManager }).catch((err) => {
    console.error('[chatlab-mcp] Fatal error:', err)
    process.exit(1)
  })
}

main()
