import {
  NAVIGATION_LAYOUT_SCHEMA_VERSION,
  type NavigationLayout,
  type NavigationLayoutLoadResult,
  type NavigationLayoutPrimaryItem,
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

export type NavigationLayoutSource = NavigationLayoutLoadResult['status'] | 'default' | 'failed'

export interface NavigationLayoutSnapshot {
  layout: NavigationLayout
  source: NavigationLayoutSource
  revision: number
}

export function canWriteNavigationLayout(source: NavigationLayoutSource): boolean {
  return source !== 'failed'
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

export function createEditableNavigationLayout(
  runtime: InsightPluginRuntime,
  layout: NavigationLayout
): NavigationLayout {
  const editable = cloneNavigationLayout(layout)
  const positionedEntryIds = new Set<string>(editable.hiddenEntryIds)
  for (const item of editable.primary) {
    if (item.kind === 'entry') positionedEntryIds.add(item.entryId)
    else for (const entryId of item.children) positionedEntryIds.add(entryId)
  }

  const newEntryIds = listInsightShellNavigation(runtime)
    .map(({ entryId }) => entryId)
    .filter((entryId) => !positionedEntryIds.has(entryId))
  if (newEntryIds.length === 0) return editable

  let defaultGroup = editable.primary.find(
    (item): item is Extract<NavigationLayoutPrimaryItem, { kind: 'group' }> =>
      item.kind === 'group' && item.id === DEFAULT_INSIGHT_NAVIGATION_GROUP_ID
  )
  if (!defaultGroup) {
    defaultGroup = { kind: 'group', id: DEFAULT_INSIGHT_NAVIGATION_GROUP_ID, children: [] }
    editable.primary.push(defaultGroup)
  }
  defaultGroup.children.push(...newEntryIds)
  return editable
}

export type NavigationEntryDestination = { kind: 'primary' } | { kind: 'group'; groupId: string } | { kind: 'hidden' }

export function placeNavigationEntry(
  layout: NavigationLayout,
  entryId: string,
  destination: NavigationEntryDestination
): NavigationLayout {
  const currentDestination = findNavigationEntryDestination(layout, entryId)
  if (
    currentDestination?.kind === destination.kind &&
    (currentDestination.kind !== 'group' ||
      (destination.kind === 'group' && currentDestination.groupId === destination.groupId))
  ) {
    return cloneNavigationLayout(layout)
  }

  const next = cloneNavigationLayout(layout)
  const primary: NavigationLayoutPrimaryItem[] = []
  for (const item of next.primary) {
    if (item.kind === 'entry') {
      if (item.entryId !== entryId) primary.push(item)
    } else {
      primary.push({ ...item, children: item.children.filter((childId) => childId !== entryId) })
    }
  }
  next.primary = primary
  next.hiddenEntryIds = next.hiddenEntryIds.filter((hiddenId) => hiddenId !== entryId)

  if (destination.kind === 'primary') next.primary.push({ kind: 'entry', entryId })
  else if (destination.kind === 'hidden') next.hiddenEntryIds.push(entryId)
  else {
    let group = next.primary.find(
      (item): item is Extract<NavigationLayoutPrimaryItem, { kind: 'group' }> =>
        item.kind === 'group' && item.id === destination.groupId
    )
    if (!group && destination.groupId === DEFAULT_INSIGHT_NAVIGATION_GROUP_ID) {
      group = { kind: 'group', id: DEFAULT_INSIGHT_NAVIGATION_GROUP_ID, children: [] }
      next.primary.push(group)
    }
    if (!group) throw new Error(`Navigation group "${destination.groupId}" does not exist`)
    group.children.push(entryId)
  }
  return next
}

export function movePrimaryNavigationItem(layout: NavigationLayout, index: number, offset: -1 | 1): NavigationLayout {
  const next = cloneNavigationLayout(layout)
  moveArrayItem(next.primary, index, offset)
  return next
}

export function moveGroupedNavigationEntry(
  layout: NavigationLayout,
  groupId: string,
  index: number,
  offset: -1 | 1
): NavigationLayout {
  const next = cloneNavigationLayout(layout)
  const group = next.primary.find(
    (item): item is Extract<NavigationLayoutPrimaryItem, { kind: 'group' }> =>
      item.kind === 'group' && item.id === groupId
  )
  if (!group) throw new Error(`Navigation group "${groupId}" does not exist`)
  moveArrayItem(group.children, index, offset)
  return next
}

export function moveHiddenNavigationEntry(layout: NavigationLayout, index: number, offset: -1 | 1): NavigationLayout {
  const next = cloneNavigationLayout(layout)
  moveArrayItem(next.hiddenEntryIds, index, offset)
  return next
}

export function cloneNavigationLayout(layout: NavigationLayout): NavigationLayout {
  return {
    schemaVersion: layout.schemaVersion,
    primary: layout.primary.map((item) =>
      item.kind === 'entry' ? { ...item } : { ...item, children: [...item.children] }
    ),
    hiddenEntryIds: [...layout.hiddenEntryIds],
  }
}

function findNavigationEntryDestination(layout: NavigationLayout, entryId: string): NavigationEntryDestination | null {
  if (layout.hiddenEntryIds.includes(entryId)) return { kind: 'hidden' }
  for (const item of layout.primary) {
    if (item.kind === 'entry' && item.entryId === entryId) return { kind: 'primary' }
    if (item.kind === 'group' && item.children.includes(entryId)) return { kind: 'group', groupId: item.id }
  }
  return null
}

function moveArrayItem<T>(items: T[], index: number, offset: -1 | 1): void {
  const targetIndex = index + offset
  if (index < 0 || index >= items.length || targetIndex < 0 || targetIndex >= items.length) return
  const [item] = items.splice(index, 1)
  items.splice(targetIndex, 0, item!)
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

  applyLoadFailure(): void {
    this.layout = createDefaultNavigationLayout(this.runtime)
    this.source = 'failed'
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
