export interface ParsedStableVersion {
  major: number
  minor: number
  patch: number
}

interface ParsedComparableVersion extends ParsedStableVersion {
  prerelease: boolean
}

function parseStableVersion(version: string): ParsedStableVersion | null {
  const normalized = version.trim().replace(/^v/i, '')
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(normalized)
  if (!match) return null

  return buildParsedVersion(match)
}

function parseComparableCurrentVersion(version: string): ParsedComparableVersion | null {
  const normalized = version.trim().replace(/^v/i, '')
  const match = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/.exec(normalized)
  if (!match) return null

  return {
    ...buildParsedVersion(match),
    prerelease: Boolean(match[4]),
  }
}

function buildParsedVersion(match: RegExpExecArray): ParsedStableVersion {
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
  const currentVersion = parseComparableCurrentVersion(current)
  if (!latestVersion || !currentVersion) return false

  if (latestVersion.major !== currentVersion.major) return latestVersion.major > currentVersion.major
  if (latestVersion.minor !== currentVersion.minor) return latestVersion.minor > currentVersion.minor
  if (latestVersion.patch !== currentVersion.patch) return latestVersion.patch > currentVersion.patch
  return currentVersion.prerelease
}
