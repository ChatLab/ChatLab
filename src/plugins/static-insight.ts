import type { RuntimePlatform } from '@/utils/platform-capabilities'
import { DisposableStore } from './core'
import {
  createInsightPluginRuntime,
  type InsightPageDefinition,
  type InsightPlugin,
  type InsightPluginRuntime,
} from './insight'
import type { PluginLocaleRegistry } from './locale'
import type { UiHostContext, UiServiceRegistrar, UiServiceRegistry } from './ui-host'

export interface StaticInsightPluginDescriptor {
  plugin: InsightPlugin
  installUiServices?: (services: UiServiceRegistrar) => Promise<void>
}

export function createStaticInsightPluginRuntime(
  platform: RuntimePlatform,
  ui: UiHostContext,
  localeRegistry: PluginLocaleRegistry,
  descriptors: readonly StaticInsightPluginDescriptor[],
  reservedPages: readonly InsightPageDefinition[] = []
): InsightPluginRuntime {
  return createInsightPluginRuntime(
    platform,
    ui,
    localeRegistry,
    descriptors.map(({ plugin }) => plugin),
    reservedPages
  )
}

export async function installStaticInsightPluginUiServices(
  descriptors: readonly StaticInsightPluginDescriptor[],
  runtime: InsightPluginRuntime,
  services: UiServiceRegistry
): Promise<void> {
  for (const descriptor of descriptors) {
    if (!runtime.isActive(descriptor.plugin.id) || !descriptor.installUiServices) continue
    const pluginServices = new DisposableStore()
    try {
      await descriptor.installUiServices({
        register: (key, service) => pluginServices.add(services.register(key, service)),
      })
      runtime.addDisposer(descriptor.plugin.id, () => pluginServices.dispose())
    } catch (error) {
      const cleanupErrors: unknown[] = []
      try {
        pluginServices.dispose()
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError)
      }
      try {
        runtime.dispose(descriptor.plugin.id)
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError)
      }
      if (cleanupErrors.length > 0) {
        throw new AggregateError([error, ...cleanupErrors], `Insight plugin "${descriptor.plugin.id}" rollback failed`)
      }
      throw error
    }
  }
}
