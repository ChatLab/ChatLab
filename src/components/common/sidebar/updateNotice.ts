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

export function shouldUseCachedUpdateNotice(
  cache: UpdateNoticeCache,
  options: { isElectron: boolean; currentVersion: string; now?: number }
): boolean {
  const now = options.now ?? Date.now()
  if (now - cache.lastCheckTime >= UPDATE_CHECK_INTERVAL_MS) return false
  if (cache.currentVersion !== options.currentVersion) return false

  // CLI Web 的正向结果必须重新问服务端，避免 CLI 已更新但浏览器还保留旧 badge。
  if (!options.isElectron && cache.hasUpdate) return false

  return true
}
