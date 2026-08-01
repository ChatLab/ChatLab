import path from 'node:path'
import os from 'node:os'
import type { Command } from 'commander'
import { installCliLocalEmbeddingRuntime } from './local-runtime'

const LOCAL_EMBEDDING_COMPONENT = 'local-embedding'

export function registerRuntimeCommand(program: Command): void {
  program
    .command('runtime', { hidden: true })
    .command('install <component>', { hidden: true })
    .action(async (component: string) => {
      if (component !== LOCAL_EMBEDDING_COMPONENT) {
        throw new Error(`Unknown ChatLab runtime component: ${component}`)
      }
      const aiDataDir = path.join(os.homedir(), '.chatlab', 'ai')
      const runtimeDir = await installCliLocalEmbeddingRuntime(aiDataDir)
      console.log(`Local embedding runtime installed: ${runtimeDir}`)
    })
}
