import type { RuntimePlatform } from '@/utils/platform-capabilities'
import type { InsightPageDefinition, InsightPluginRuntime } from './insight'

export interface LegacyInsightPage extends InsightPageDefinition {
  platforms: readonly RuntimePlatform[]
  order: number
}

export const LEGACY_INSIGHT_PAGES: readonly LegacyInsightPage[] = [
  {
    id: 'relationship-changes',
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
  const pluginPages = runtime.listNavigation().map(({ entry, page }) => ({ page, order: entry.order }))
  const availableLegacyPages = legacyPages
    .filter((page) => page.platforms.includes(runtime.platform))
    .map((page) => ({ page, order: page.order }))

  const pages = [...pluginPages, ...availableLegacyPages]
    .sort((left, right) => left.order - right.order || left.page.id.localeCompare(right.page.id))
    .map(({ page }) => page)

  const pageIds = new Set<string>()
  for (const page of pages) {
    if (pageIds.has(page.id)) throw new Error(`Duplicate Insight shell page "${page.id}"`)
    pageIds.add(page.id)
  }
  return pages
}

export function getLegacyInsightPages(platform: RuntimePlatform): InsightPageDefinition[] {
  return LEGACY_INSIGHT_PAGES.filter((page) => page.platforms.includes(platform))
}
