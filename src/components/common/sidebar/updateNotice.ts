import { isNewerStableVersion } from '@openchatlab/core'

export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

export interface UpdateNoticeState {
  latestVersion: string
  currentVersion: string
  hasUpdate: boolean
}

export interface UpdateNoticeCache extends UpdateNoticeState {
  lastCheckTime: number
  currentVersion: string
}

export function buildUpdateNoticeState(options: {
  latestVersion: string | null | undefined
  currentVersion: string
  serverHasUpdate?: boolean
}): UpdateNoticeState {
  const latestVersion = options.latestVersion || ''
  return {
    latestVersion,
    currentVersion: options.currentVersion,
    hasUpdate:
      typeof options.serverHasUpdate === 'boolean'
        ? options.serverHasUpdate
        : Boolean(latestVersion && isNewerStableVersion(latestVersion, options.currentVersion)),
  }
}

export function buildUpdateNoticeCacheEntry(
  state: UpdateNoticeState | null,
  now: number = Date.now()
): UpdateNoticeCache | null {
  if (!state) return null
  return {
    lastCheckTime: now,
    latestVersion: state.latestVersion,
    hasUpdate: state.hasUpdate,
    currentVersion: state.currentVersion,
  }
}

export function shouldUseCachedUpdateNotice(
  cache: UpdateNoticeCache,
  options: { isElectron: boolean; currentVersion: string; now?: number }
): boolean {
  if (!options.isElectron) return false

  const now = options.now ?? Date.now()
  if (now - cache.lastCheckTime >= UPDATE_CHECK_INTERVAL_MS) return false
  if (cache.currentVersion !== options.currentVersion) return false

  return true
}

export function getUsableCachedUpdateNotice(
  cache: UpdateNoticeCache,
  options: { isElectron: boolean; currentVersion: string; now?: number }
): UpdateNoticeCache | null {
  return shouldUseCachedUpdateNotice(cache, options) ? cache : null
}
