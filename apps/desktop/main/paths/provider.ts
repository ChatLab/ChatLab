/**
 * Electron PathProvider implementation and main-process singleton.
 */

import type { PathProvider } from '@openchatlab/core'
import {
  getAiDataDir,
  getCacheDir,
  getDatabaseDir,
  getDownloadsDir,
  getLogsDir,
  getSettingsDir,
  getSystemDataDir,
  getTempDir,
  getUserDataDir,
  getVectorDir,
} from './locations'

export class ElectronPathProvider implements PathProvider {
  getSystemDir(): string {
    return getSystemDataDir()
  }
  getUserDataDir(): string {
    return getUserDataDir()
  }
  getDatabaseDir(): string {
    return getDatabaseDir()
  }
  getVectorDir(): string {
    return getVectorDir()
  }
  getAiDataDir(): string {
    return getAiDataDir()
  }
  getSettingsDir(): string {
    return getSettingsDir()
  }
  getCacheDir(): string {
    return getCacheDir()
  }
  getTempDir(): string {
    return getTempDir()
  }
  getLogsDir(): string {
    return getLogsDir()
  }
  getDownloadsDir(): string {
    return getDownloadsDir()
  }
}

let provider: PathProvider | null = null

export function getPathProvider(): PathProvider {
  if (!provider) provider = new ElectronPathProvider()
  return provider
}
