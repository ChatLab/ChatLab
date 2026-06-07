export function shouldMarkUnifiedDirMigrationDone(failedDirs: string[]): boolean {
  return failedDirs.length === 0
}
