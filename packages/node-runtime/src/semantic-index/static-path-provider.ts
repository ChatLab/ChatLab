import type { PathProvider } from '@openchatlab/core'

export interface StaticPathProviderSnapshot {
  systemDir: string
  userDataDir: string
  databaseDir: string
  vectorDir: string
  aiDataDir: string
  settingsDir: string
  cacheDir: string
  tempDir: string
  logsDir: string
  downloadsDir: string
}

export function snapshotPathProvider(pathProvider: PathProvider): StaticPathProviderSnapshot {
  return {
    systemDir: pathProvider.getSystemDir(),
    userDataDir: pathProvider.getUserDataDir(),
    databaseDir: pathProvider.getDatabaseDir(),
    vectorDir: pathProvider.getVectorDir(),
    aiDataDir: pathProvider.getAiDataDir(),
    settingsDir: pathProvider.getSettingsDir(),
    cacheDir: pathProvider.getCacheDir(),
    tempDir: pathProvider.getTempDir(),
    logsDir: pathProvider.getLogsDir(),
    downloadsDir: pathProvider.getDownloadsDir(),
  }
}

export class StaticPathProvider implements PathProvider {
  constructor(private readonly paths: StaticPathProviderSnapshot) {}

  getSystemDir(): string {
    return this.paths.systemDir
  }

  getUserDataDir(): string {
    return this.paths.userDataDir
  }

  getDatabaseDir(): string {
    return this.paths.databaseDir
  }

  getVectorDir(): string {
    return this.paths.vectorDir
  }

  getAiDataDir(): string {
    return this.paths.aiDataDir
  }

  getSettingsDir(): string {
    return this.paths.settingsDir
  }

  getCacheDir(): string {
    return this.paths.cacheDir
  }

  getTempDir(): string {
    return this.paths.tempDir
  }

  getLogsDir(): string {
    return this.paths.logsDir
  }

  getDownloadsDir(): string {
    return this.paths.downloadsDir
  }
}
