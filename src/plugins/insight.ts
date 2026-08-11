import type { RuntimePlatform } from '@/utils/platform-capabilities'
import { ContributionRegistry, PluginHost, type ChatLabPlugin, type DisposableStore, type Disposer } from './core'
import type { LocalizedText, PluginLocaleMessages, PluginLocaleRegistry } from './locale'
import type { UiHostContext } from './ui-host'

export type InsightTimeMode = 'recent' | 'quarter' | 'year' | 'custom'

export interface InsightTimeFilterContribution {
  allowedModes: readonly InsightTimeMode[]
  allowedRecentDays?: readonly number[]
  defaultMode: InsightTimeMode
}

export interface InsightPageDefinition {
  id: string
  path: string
  routeName: string
  title: LocalizedText
  icon: string
  filters?: {
    time?: InsightTimeFilterContribution
  }
}

export interface UiEntry {
  load(): Promise<unknown>
}

export interface InsightPageContribution extends InsightPageDefinition {
  default?: boolean
  view: UiEntry
}

export interface InsightNavigationContribution {
  id: string
  pageId: string
  order: number
}

export interface InsightPluginContext {
  ui: UiHostContext
  locale: {
    register<TKey extends string>(namespace: string, messages: PluginLocaleMessages<TKey>): Disposer
  }
  pages: {
    register(contribution: InsightPageContribution): Disposer
  }
  navigation: {
    register(contribution: InsightNavigationContribution): Disposer
  }
}

export type InsightPlugin = ChatLabPlugin<InsightPluginContext>

export interface ResolvedInsightNavigation {
  entry: InsightNavigationContribution
  page: InsightPageContribution
}

export function normalizeInsightPageContribution(page: InsightPageContribution): InsightPageContribution {
  const time = page.filters?.time
  if (!time) return page

  const allowedModes = [...new Set(time.allowedModes)]
  if (allowedModes.length === 0) throw new Error(`Insight page "${page.id}" must allow at least one time mode`)
  if (!allowedModes.includes(time.defaultMode)) {
    throw new Error(`Insight page "${page.id}" has a default time mode that is not allowed`)
  }

  if (time.allowedRecentDays?.some((days) => !Number.isInteger(days) || days < 0)) {
    throw new Error(`Insight page "${page.id}" has invalid recent-day options`)
  }
  const allowedRecentDays = time.allowedRecentDays ? [...new Set(time.allowedRecentDays)] : undefined

  return {
    ...page,
    filters: {
      ...page.filters,
      time: {
        ...time,
        allowedModes,
        allowedRecentDays,
      },
    },
  }
}

export class InsightPluginRuntime {
  private readonly pages = new ContributionRegistry<InsightPageContribution>()
  private readonly navigation = new ContributionRegistry<InsightNavigationContribution>()
  private readonly host: PluginHost<InsightPluginContext>

  constructor(
    readonly platform: RuntimePlatform,
    readonly ui: UiHostContext,
    private readonly localeRegistry: PluginLocaleRegistry,
    private readonly reservedPages: readonly InsightPageDefinition[] = []
  ) {
    this.host = new PluginHost(platform, (pluginId, disposables) => this.createPluginContext(pluginId, disposables))
    this.validateContributions()
  }

  activate(plugin: InsightPlugin): boolean {
    const activated = this.host.activate(plugin)
    if (!activated) return false

    try {
      this.validateContributions()
      return true
    } catch (error) {
      this.host.dispose(plugin.id)
      throw error
    }
  }

  activateAll(plugins: readonly InsightPlugin[]): void {
    for (const plugin of plugins) this.activate(plugin)
  }

  isActive(pluginId: string): boolean {
    return this.host.isActive(pluginId)
  }

  addDisposer(pluginId: string, disposer: Disposer): void {
    this.host.addDisposer(pluginId, disposer)
  }

  getPage(pageId: string): InsightPageContribution | undefined {
    return this.pages.get(pageId)
  }

  listPages(): InsightPageContribution[] {
    return this.pages.list()
  }

  listNavigation(): ResolvedInsightNavigation[] {
    return this.navigation
      .list()
      .map((entry) => {
        const page = this.pages.get(entry.pageId)
        if (!page) throw new Error(`Insight navigation "${entry.id}" targets unknown page "${entry.pageId}"`)
        return { entry, page }
      })
      .sort((left, right) => left.entry.order - right.entry.order || left.entry.id.localeCompare(right.entry.id))
  }

  getDefaultPage(): InsightPageContribution | undefined {
    return this.pages.list().find((page) => page.default)
  }

  dispose(pluginId: string): void {
    this.host.dispose(pluginId)
  }

  disposeAll(): void {
    this.host.disposeAll()
  }

  private createPluginContext(pluginId: string, disposables: DisposableStore): InsightPluginContext {
    return {
      ui: this.ui,
      locale: {
        register: (namespace, messages) => disposables.add(this.localeRegistry.register(pluginId, namespace, messages)),
      },
      pages: {
        register: (contribution) => {
          const expectedNamespace = `plugins.${pluginId}`
          if (contribution.title.namespace !== expectedNamespace) {
            throw new Error(
              `Plugin "${pluginId}" page "${contribution.id}" must use locale namespace "${expectedNamespace}"`
            )
          }
          return disposables.add(this.pages.register(pluginId, normalizeInsightPageContribution(contribution)))
        },
      },
      navigation: {
        register: (contribution) => disposables.add(this.navigation.register(pluginId, contribution)),
      },
    }
  }

  private validateContributions(): void {
    const pageIds = new Set<string>()
    const routeNames = new Set<string>()
    const paths = new Set<string>()
    let defaultPageId: string | undefined

    for (const page of this.reservedPages) {
      if (pageIds.has(page.id)) throw new Error(`Duplicate host Insight page id "${page.id}"`)
      if (routeNames.has(page.routeName)) throw new Error(`Duplicate host Insight route name "${page.routeName}"`)
      if (paths.has(page.path)) throw new Error(`Duplicate host Insight route path "${page.path}"`)
      pageIds.add(page.id)
      routeNames.add(page.routeName)
      paths.add(page.path)
    }

    for (const page of this.pages.list()) {
      if (pageIds.has(page.id)) throw new Error(`Insight page id "${page.id}" conflicts with a host page`)
      if (routeNames.has(page.routeName)) throw new Error(`Duplicate Insight route name "${page.routeName}"`)
      if (paths.has(page.path)) throw new Error(`Duplicate Insight route path "${page.path}"`)
      pageIds.add(page.id)
      routeNames.add(page.routeName)
      paths.add(page.path)

      if (!page.default) continue
      if (defaultPageId) throw new Error(`Insight default pages conflict: "${defaultPageId}" and "${page.id}"`)
      defaultPageId = page.id
    }

    const navigationPageIds = new Set<string>()
    for (const entry of this.navigation.list()) {
      if (!this.pages.get(entry.pageId)) {
        throw new Error(`Insight navigation "${entry.id}" targets unknown page "${entry.pageId}"`)
      }
      if (navigationPageIds.has(entry.pageId)) {
        throw new Error(`Insight page "${entry.pageId}" has multiple default navigation entries`)
      }
      navigationPageIds.add(entry.pageId)
    }
    if (defaultPageId && !navigationPageIds.has(defaultPageId)) {
      throw new Error(`Default Insight page "${defaultPageId}" must have a navigation entry`)
    }
  }
}

export function createInsightPluginRuntime(
  platform: RuntimePlatform,
  ui: UiHostContext,
  localeRegistry: PluginLocaleRegistry,
  plugins: readonly InsightPlugin[] = [],
  reservedPages: readonly InsightPageDefinition[] = []
): InsightPluginRuntime {
  const runtime = new InsightPluginRuntime(platform, ui, localeRegistry, reservedPages)
  runtime.activateAll(plugins)
  return runtime
}
