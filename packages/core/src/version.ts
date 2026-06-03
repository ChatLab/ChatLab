export interface ParsedStableVersion {
  major: number
  minor: number
  patch: number
}

function parseStableVersion(version: string): ParsedStableVersion | null {
  const normalized = version.trim().replace(/^v/i, '')
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(normalized)
  if (!match) return null

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

export function isStableVersion(version: string): boolean {
  return parseStableVersion(version) !== null
}

export function isNewerStableVersion(latest: string, current: string): boolean {
  const latestVersion = parseStableVersion(latest)
  const currentVersion = parseStableVersion(current)
  if (!latestVersion || !currentVersion) return false

  if (latestVersion.major !== currentVersion.major) return latestVersion.major > currentVersion.major
  if (latestVersion.minor !== currentVersion.minor) return latestVersion.minor > currentVersion.minor
  return latestVersion.patch > currentVersion.patch
}
