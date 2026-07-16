import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ConfigStorage } from './llm-config-store'

export function createFileConfigStorage(baseDir: string): ConfigStorage {
  return {
    readJson<T>(key: string): T | null {
      try {
        return JSON.parse(fs.readFileSync(path.join(baseDir, `${key}.json`), 'utf-8')) as T
      } catch {
        return null
      }
    },
    writeJson<T>(key: string, data: T): void {
      fs.mkdirSync(baseDir, { recursive: true })
      fs.writeFileSync(path.join(baseDir, `${key}.json`), JSON.stringify(data, null, 2), 'utf-8')
    },
  }
}
