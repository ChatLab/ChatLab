import path from 'node:path'
import { createLocalEmbeddingRuntimeManager, type LocalEmbeddingRuntimeConfig } from '@openchatlab/node-runtime'

export const LOCAL_EMBEDDING_RUNTIME_DIR_ENV = 'CHATLAB_LOCAL_EMBEDDING_RUNTIME_DIR'

export function resolveCliLocalEmbeddingRuntimeConfig(
  aiDataDir: string,
  env: NodeJS.ProcessEnv = process.env
): LocalEmbeddingRuntimeConfig {
  const preinstalledDir = env[LOCAL_EMBEDDING_RUNTIME_DIR_ENV]?.trim()
  if (preinstalledDir) {
    return {
      baseDir: path.resolve(preinstalledDir),
      installMode: 'preinstalled',
    }
  }
  return {
    baseDir: path.join(aiDataDir, 'runtime', 'local-embedding'),
    installMode: 'auto',
  }
}

export async function installCliLocalEmbeddingRuntime(
  aiDataDir: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<string> {
  const config = resolveCliLocalEmbeddingRuntimeConfig(aiDataDir, env)
  const manager = createLocalEmbeddingRuntimeManager({
    ...config,
    // The build-time installer populates a directory that normal app startup treats as read-only.
    installMode: 'auto',
  })
  return await manager.ensureInstalled()
}
