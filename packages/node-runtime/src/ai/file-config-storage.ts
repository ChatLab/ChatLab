import * as path from 'node:path'
import { readJsonFile, withFileLock, writeJsonFileAtomically } from '@openchatlab/config'
import type { ConfigStorage } from './llm-config-store'

export function createFileConfigStorage(baseDir: string): ConfigStorage {
  const heldLocks = new Set<string>()
  const getFilePath = (key: string) => path.join(baseDir, `${key}.json`)

  return {
    readJson<T>(key: string): T | null {
      return readJsonFile<T>(getFilePath(key))
    },
    writeJson<T>(key: string, data: T): void {
      const filePath = getFilePath(key)
      const write = () => writeJsonFileAtomically(filePath, data)
      if (heldLocks.has(key)) write()
      else withFileLock(filePath, write)
    },
    withLock<T>(key: string, action: () => T): T {
      if (heldLocks.has(key)) return action()
      return withFileLock(getFilePath(key), () => {
        heldLocks.add(key)
        try {
          return action()
        } finally {
          heldLocks.delete(key)
        }
      })
    },
  }
}
