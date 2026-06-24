import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { ArchiveImportSourceManager } from '../../../packages/node-runtime/src/import/archive/source-manager'

let sourceManager: ArchiveImportSourceManager | null = null

export function getArchiveImportSourceManager(): ArchiveImportSourceManager {
  if (!sourceManager) {
    sourceManager = new ArchiveImportSourceManager({
      tempRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-desktop-import-sources-')),
    })
  }
  return sourceManager
}

export async function importPreparedChatWithSource<T>(
  manager: ArchiveImportSourceManager,
  sourceId: string,
  chatId: string,
  importer: (manifestPath: string) => Promise<T>
): Promise<T> {
  return manager.withMaterializedChat(sourceId, chatId, importer)
}

export async function cleanupArchiveImportSources(): Promise<void> {
  if (!sourceManager) return
  const manager = sourceManager
  sourceManager = null
  await manager.close()
}
