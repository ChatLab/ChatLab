#!/usr/bin/env node

/**
 * ChatLab MCP Server entry point
 *
 * Usage:
 *   chatlab-mcp [--db-dir <path>] [--http] [--port <number>]
 *
 * Options:
 *   --db-dir   Path to the ChatLab databases directory
 *   --http     Start HTTP/SSE server instead of stdio
 *   --port     HTTP server port (default: 3000)
 *
 * Environment variables:
 *   CHATLAB_DB_DIR   Alternative way to specify the database directory
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { initDbDir, getDefaultDbDir } from './db.js'
import { createServer } from './server.js'
import { startHttpServer } from './http.js'

// Parse command line arguments
function parseArgs(): { dbDir: string; http: boolean; port: number } {
  const args = process.argv.slice(2)
  let dbDir = ''
  let http = false
  let port = 3000

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--db-dir':
        dbDir = args[++i] || ''
        break
      case '--http':
        http = true
        break
      case '--port':
        port = parseInt(args[++i] || '3000', 10)
        break
    }
  }

  // Fallback to environment variable
  if (!dbDir) {
    dbDir = process.env.CHATLAB_DB_DIR || ''
  }

  // Fallback to default platform path
  if (!dbDir) {
    dbDir = getDefaultDbDir()
  }

  return { dbDir, http, port }
}

async function main(): Promise<void> {
  const { dbDir, http, port } = parseArgs()

  // Initialize database directory
  initDbDir(dbDir)
  console.error(`[ChatLab MCP] Database directory: ${dbDir}`)

  // Create MCP server
  const server = createServer()

  if (http) {
    // HTTP/SSE mode
    await startHttpServer(server, port)
  } else {
    // Stdio mode (default)
    const transport = new StdioServerTransport()
    await server.connect(transport)
    console.error('[ChatLab MCP] Server running on stdio')
  }
}

main().catch((error) => {
  console.error('[ChatLab MCP] Fatal error:', error)
  process.exit(1)
})
