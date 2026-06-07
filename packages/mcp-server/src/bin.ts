#!/usr/bin/env node

/**
 * Standalone MCP Server entry for `npx -y chatlab-mcp`
 *
 * Initializes runtime (config, paths, database) and starts the MCP server.
 * All logs go to stderr; stdout is reserved for MCP protocol communication.
 */

import { loadConfig } from '@openchatlab/config'
import { startMcpServer } from './server'
import { initStandaloneMcpRuntime } from './standalone-runtime'
import { getMcpPackageVersion } from './runtime-version'

function main(): void {
  const config = loadConfig()
  const userDataDir = config.data.user_data_dir || undefined
  const version = getMcpPackageVersion()
  const { dbManager } = initStandaloneMcpRuntime(version, userDataDir)

  startMcpServer({ version, dbManager }).catch((err) => {
    console.error('[chatlab-mcp] Fatal error:', err)
    process.exit(1)
  })
}

main()
