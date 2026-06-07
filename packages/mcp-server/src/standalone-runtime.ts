import {
  assertDataDirCompatible,
  DatabaseManager,
  NodePathProvider,
  type RuntimeIdentity,
} from '@openchatlab/node-runtime'

export function initStandaloneMcpRuntime(
  version: string,
  userDataDir?: string
): { dbManager: DatabaseManager; pathProvider: NodePathProvider; runtime: RuntimeIdentity } {
  const pathProvider = new NodePathProvider(userDataDir)
  pathProvider.ensureAllDirs()
  const runtime: RuntimeIdentity = { version, kind: 'mcp' }
  assertDataDirCompatible(pathProvider, runtime)
  const dbManager = new DatabaseManager(pathProvider, { runtime })
  return { dbManager, pathProvider, runtime }
}
