import cnChangelogs from '../../../changelogs/cn.json'
import enChangelogs from '../../../changelogs/en.json'
import jaChangelogs from '../../../changelogs/ja.json'
import twChangelogs from '../../../changelogs/tw.json'

export type ChangelogChangeType = 'feat' | 'fix' | 'refactor' | 'docs' | 'chore' | 'style' | 'ci'

export interface ChangelogItem {
  version: string
  date: string
  summary: string
  changes: {
    type: ChangelogChangeType
    items: string[]
  }[]
}

const BUNDLED_CHANGELOGS: Record<string, ChangelogItem[]> = {
  'en-US': enChangelogs as ChangelogItem[],
  'zh-CN': cnChangelogs as ChangelogItem[],
  'zh-TW': twChangelogs as ChangelogItem[],
  'ja-JP': jaChangelogs as ChangelogItem[],
}

export function normalizeChangelogVersion(version?: string | null) {
  return version ? version.trim().replace(/^v/i, '') : null
}

export function getBundledChangelogs(locale: string): ChangelogItem[] {
  return BUNDLED_CHANGELOGS[locale] ?? BUNDLED_CHANGELOGS['en-US']
}

export function getBundledLatestVersion(locale: string) {
  return getBundledChangelogs(locale)[0]?.version || null
}

export function hasBundledChangelogVersion(locale: string, version?: string | null) {
  const normalizedVersion = normalizeChangelogVersion(version)
  if (!normalizedVersion) return false
  return getBundledChangelogs(locale).some((log) => normalizeChangelogVersion(log.version) === normalizedVersion)
}

export function isBundledLatestVersion(locale: string, version?: string | null) {
  const normalizedVersion = normalizeChangelogVersion(version)
  const latestVersion = normalizeChangelogVersion(getBundledLatestVersion(locale))
  return Boolean(normalizedVersion && latestVersion && normalizedVersion === latestVersion)
}
