import {
  NAVIGATION_LAYOUT_SCHEMA_VERSION,
  type NavigationLayout,
  type NavigationLayoutLoadResult,
} from '@openchatlab/shared-types'
import type { InsightPageDefinition, InsightPluginRuntime } from '@/plugins/insight'
import { listInsightShellNavigation } from '@/plugins/insight-catalog'
import type { Disposer } from '@/plugins/core'

export const DEFAULT_INSIGHT_NAVIGATION_GROUP_ID = 'host.insight'

export interface ResolvedNavigationEntry {
  kind: 'entry'
  entryId: string
  page: InsightPageDefinition
}

export interface ResolvedNavigationGroup {
  kind: 'group'
  id: string
  title?: string
  entries: ResolvedNavigationEntry[]
}

export type ResolvedPrimaryNavigationItem = ResolvedNavigationEntry | ResolvedNavigationGroup

export interface ResolvedNavigationLayout {
  primary: ResolvedPrimaryNavigationItem[]
  hiddenEntryIds: string[]
}

export function listResolvedNavigationEntries(layout: ResolvedNavigationLayout): ResolvedNavigationEntry[] {
  return layout.primary.flatMap((item) => (item.kind === 'entry' ? [item] : item.entries))
}

export interface NavigationLayoutSnapshot {
  layout: NavigationLayout
  source: NavigationLayoutLoadResult['status'] | 'default'
  revision: number
}

export function createDefaultNavigationLayout(runtime: InsightPluginRuntime): NavigationLayout {
  return {
    schemaVersion: NAVIGATION_LAYOUT_SCHEMA_VERSION,
    primary: [
      {
        kind: 'group',
        id: DEFAULT_INSIGHT_NAVIGATION_GROUP_ID,
        children: listInsightShellNavigation(runtime).map(({ entryId }) => entryId),
      },
    ],
    hiddenEntryIds: [],
  }
}

export function resolveNavigationLayout(
  runtime: InsightPluginRuntime,
  layout: NavigationLayout
): ResolvedNavigationLayout {
  const catalog = listInsightShellNavigation(runtime)
  const availableEntries = new Map(
    catalog.map(({ entryId, page }) => [entryId, { kind: 'entry' as const, entryId, page }])
  )
  const hiddenEntryIds = new Set(layout.hiddenEntryIds)
  const positionedEntryIds = new Set<string>()
  const primary: ResolvedPrimaryNavigationItem[] = []

  for (const item of layout.primary) {
    if (item.kind === 'entry') {
      positionedEntryIds.add(item.entryId)
      const entry = availableEntries.get(item.entryId)
      if (entry && !hiddenEntryIds.has(item.entryId)) primary.push(entry)
      continue
    }

    const entries: ResolvedNavigationEntry[] = []
    for (const entryId of item.children) {
      positionedEntryIds.add(entryId)
      const entry = availableEntries.get(entryId)
      if (entry && !hiddenEntryIds.has(entryId)) entries.push(entry)
    }
    if (entries.length > 0) primary.push({ kind: 'group', id: item.id, title: item.title, entries })
  }

  const newEntries = catalog
    .filter(({ entryId }) => !positionedEntryIds.has(entryId) && !hiddenEntryIds.has(entryId))
    .map(({ entryId }) => availableEntries.get(entryId)!)
  if (newEntries.length > 0) {
    const defaultGroup = primary.find(
      (item): item is ResolvedNavigationGroup =>
        item.kind === 'group' && item.id === DEFAULT_INSIGHT_NAVIGATION_GROUP_ID
    )
    if (defaultGroup) defaultGroup.entries.push(...newEntries)
    else primary.push({ kind: 'group', id: DEFAULT_INSIGHT_NAVIGATION_GROUP_ID, entries: newEntries })
  }

  return { primary, hiddenEntryIds: [...layout.hiddenEntryIds] }
}

export class NavigationLayoutController {
  private layout: NavigationLayout
  private source: NavigationLayoutSnapshot['source'] = 'default'
  private revision = 0
  private readonly listeners = new Set<() => void>()

  constructor(readonly runtime: InsightPluginRuntime) {
    this.layout = createDefaultNavigationLayout(runtime)
  }

  getSnapshot(): NavigationLayoutSnapshot {
    return { layout: this.layout, source: this.source, revision: this.revision }
  }

  getResolvedLayout(): ResolvedNavigationLayout {
    return resolveNavigationLayout(this.runtime, this.layout)
  }

  applyLoadResult(result: NavigationLayoutLoadResult): void {
    this.layout = result.layout ?? createDefaultNavigationLayout(this.runtime)
    this.source = result.status
    this.emit()
  }

  applySavedLayout(layout: NavigationLayout): void {
    this.layout = layout
    this.source = 'saved'
    this.emit()
  }

  applyDefaultLayout(): void {
    this.layout = createDefaultNavigationLayout(this.runtime)
    this.source = 'default'
    this.emit()
  }

  subscribe(listener: () => void): Disposer {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    this.revision++
    for (const listener of this.listeners) listener()
  }
}
