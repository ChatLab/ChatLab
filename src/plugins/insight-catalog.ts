import type { RuntimePlatform } from '@/utils/platform-capabilities'
import type { InsightPageDefinition, InsightPluginRuntime } from './insight'

export interface LegacyInsightPage extends InsightPageDefinition {
  navigationId: string
  platforms: readonly RuntimePlatform[]
  order: number
}

export const LEGACY_INSIGHT_PAGES: readonly LegacyInsightPage[] = [
  {
    id: 'relationship-changes',
    navigationId: 'insight.relationship-changes',
    path: 'relationship-changes',
    routeName: 'insight-relationship-changes',
    title: { key: 'insight.tabs.relationshipChanges' },
    icon: 'i-lucide-git-compare-arrows',
    platforms: ['electron', 'cli-web'],
    order: 30,
  },
]

export function listInsightShellPages(
  runtime: InsightPluginRuntime,
  legacyPages: readonly LegacyInsightPage[] = LEGACY_INSIGHT_PAGES
): InsightPageDefinition[] {
  const pages = listInsightShellNavigation(runtime, legacyPages).map(({ page }) => page)

  const pageIds = new Set<string>()
  for (const page of pages) {
    if (pageIds.has(page.id)) throw new Error(`Duplicate Insight shell page "${page.id}"`)
    pageIds.add(page.id)
  }
  return pages
}

export interface InsightShellNavigationItem {
  entryId: string
  order: number
  page: InsightPageDefinition
}

export function listInsightShellNavigation(
  runtime: InsightPluginRuntime,
  legacyPages: readonly LegacyInsightPage[] = LEGACY_INSIGHT_PAGES
): InsightShellNavigationItem[] {
  const pluginItems = runtime.listNavigation().map(({ entry, page }) => ({
    entryId: entry.id,
    order: entry.order,
    page,
  }))
  const legacyItems = legacyPages
    .filter((page) => page.platforms.includes(runtime.platform))
    .map((page) => ({ entryId: page.navigationId, order: page.order, page }))

  return [...pluginItems, ...legacyItems].sort(
    (left, right) => left.order - right.order || left.entryId.localeCompare(right.entryId)
  )
}

export function getLegacyInsightPages(platform: RuntimePlatform): InsightPageDefinition[] {
  return LEGACY_INSIGHT_PAGES.filter((page) => page.platforms.includes(platform))
}
