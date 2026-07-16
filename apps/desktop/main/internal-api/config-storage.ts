import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ConfigStorage } from '@openchatlab/node-runtime'

export function createFileConfigStorage(aiDataDir: string): ConfigStorage {
  return {
    readJson<T>(key: string): T | null {
      try {
        return JSON.parse(fs.readFileSync(path.join(aiDataDir, `${key}.json`), 'utf-8')) as T
      } catch {
        return null
      }
    },
    writeJson<T>(key: string, data: T): void {
      if (!fs.existsSync(aiDataDir)) fs.mkdirSync(aiDataDir, { recursive: true })
      fs.writeFileSync(path.join(aiDataDir, `${key}.json`), JSON.stringify(data, null, 2), 'utf-8')
    },
  }
}
