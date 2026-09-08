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

/**
 * Locale for MCP tool descriptions: the configured UI language, or the system locale when unset.
 * Mirrors Desktop's initLocale, so Chinese systems keep Chinese tool descriptions.
 */
export function resolveMcpLocale(
  config: { locale?: { lang?: string } },
  systemLocale: string = Intl.DateTimeFormat().resolvedOptions().locale
): string {
  return config.locale?.lang || systemLocale
}
