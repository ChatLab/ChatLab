/**
 * CLI MCP Server entry point
 *
 * Thin wrapper: initializes Node.js runtime, then delegates to chatlab-mcp.
 */

import { loadConfig } from '@openchatlab/config'
import {
  NodePathProvider,
  DatabaseManager,
  hasPendingElectronDataWarning,
  verifyCliDataPath,
} from '@openchatlab/node-runtime'
import { startMcpServer } from 'chatlab-mcp'
import { getVersion } from './version'

function initMcpRuntime(): DatabaseManager {
  const config = loadConfig()
  const userDataDir = config.data.user_data_dir || undefined
  const pathProvider = new NodePathProvider(userDataDir)
  pathProvider.ensureAllDirs()

  if (hasPendingElectronDataWarning() || !verifyCliDataPath(pathProvider.getDatabaseDir())) {
    console.error('[MCP] Electron desktop data detected but databases not found.')
    console.error('[MCP] Set CHATLAB_DATA_DIR or edit ~/.chatlab/config.toml to point to your data directory.')
    process.exit(1)
  }

  return new DatabaseManager(pathProvider)
}

export async function startCliMcpServer(): Promise<void> {
  const dbManager = initMcpRuntime()
  await startMcpServer({ version: getVersion(), dbManager })
}
