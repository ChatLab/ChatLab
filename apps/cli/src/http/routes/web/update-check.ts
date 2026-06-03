import { isNewerStableVersion } from '@openchatlab/core'

export interface WebUpdateCheckResult {
  hasUpdate: boolean
  currentVersion: string
  latestVersion?: string
}

function isDevelopmentPlaceholderVersion(version: string): boolean {
  return /^0\.0\.0(?:$|-)/.test(version.trim())
}

export function buildWebUpdateCheckResult(options: {
  currentVersion: string
  latestVersion?: string | null
}): WebUpdateCheckResult {
  const latestVersion = options.latestVersion || options.currentVersion
  return {
    hasUpdate:
      !isDevelopmentPlaceholderVersion(options.currentVersion) &&
      isNewerStableVersion(latestVersion, options.currentVersion),
    currentVersion: options.currentVersion,
    latestVersion,
  }
}
