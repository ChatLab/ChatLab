export const MIGRATE_HINT_IGNORE_KEY = 'chatlab_ignore_migrate_default_hint'

interface MigrateHintIgnoreState {
  ignoredForDataDir: string
  ignoredAt: string
}

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function readMigrateHintIgnore(storage: StorageLike): MigrateHintIgnoreState | null {
  const raw = storage.getItem(MIGRATE_HINT_IGNORE_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<MigrateHintIgnoreState>
    if (!parsed.ignoredForDataDir || !parsed.ignoredAt) return null
    return {
      ignoredForDataDir: parsed.ignoredForDataDir,
      ignoredAt: parsed.ignoredAt,
    }
  } catch {
    return null
  }
}

export function isMigrateHintIgnoredForDir(storage: StorageLike, dataDir: string): boolean {
  const state = readMigrateHintIgnore(storage)
  return state?.ignoredForDataDir === dataDir
}

export function writeMigrateHintIgnore(storage: StorageLike, dataDir: string): void {
  storage.setItem(
    MIGRATE_HINT_IGNORE_KEY,
    JSON.stringify({
      ignoredForDataDir: dataDir,
      ignoredAt: new Date().toISOString(),
    } satisfies MigrateHintIgnoreState)
  )
}

export function clearMigrateHintIgnore(storage: StorageLike): void {
  storage.removeItem(MIGRATE_HINT_IGNORE_KEY)
}
