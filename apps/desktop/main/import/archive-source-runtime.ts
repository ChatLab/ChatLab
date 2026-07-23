import { ArchiveImportSourceManager } from '@openchatlab/node-runtime/import/archive/source-manager'

let sourceManager: ArchiveImportSourceManager | null = null

export function getArchiveImportSourceManager(): ArchiveImportSourceManager {
  if (!sourceManager) {
    sourceManager = new ArchiveImportSourceManager()
  }
  return sourceManager
}

export async function cleanupArchiveImportSources(): Promise<void> {
  if (!sourceManager) return
  const manager = sourceManager
  sourceManager = null
  await manager.close()
}
