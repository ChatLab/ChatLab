import { inject, onBeforeUnmount, shallowRef, type App, type Component, type InjectionKey } from 'vue'
import type { RouteRecordRaw } from 'vue-router'
import type { InsightPluginRuntime } from './insight'
import type { LocalizedText, LocaleParams, PluginTranslate } from './locale'
import type { UiHostContext } from './ui-host'

const INSIGHT_PLUGIN_RUNTIME_KEY: InjectionKey<InsightPluginRuntime> = Symbol('InsightPluginRuntime')
const UI_HOST_CONTEXT_KEY: InjectionKey<UiHostContext> = Symbol('UiHostContext')

export function installInsightPluginRuntime(app: App, runtime: InsightPluginRuntime): void {
  app.provide(INSIGHT_PLUGIN_RUNTIME_KEY, runtime)
  app.provide(UI_HOST_CONTEXT_KEY, runtime.ui)
}

export function useInsightPluginRuntime(): InsightPluginRuntime {
  const runtime = inject(INSIGHT_PLUGIN_RUNTIME_KEY)
  if (!runtime) throw new Error('Insight plugin runtime is unavailable')
  return runtime
}

export function useUiHostContext(): UiHostContext {
  const context = inject(UI_HOST_CONTEXT_KEY)
  if (!context) throw new Error('UI host context is unavailable')
  return context
}

export function useHostLocale(): {
  translate(text: string | LocalizedText, params?: LocaleParams): string
  formatDate(value: Date | number, options?: Intl.DateTimeFormatOptions): string
  formatNumber(value: number, options?: Intl.NumberFormatOptions): string
} {
  const locale = useUiHostContext().locale
  const revision = shallowRef(locale.getSnapshot().revision)
  const unsubscribe = locale.subscribe(() => {
    revision.value = locale.getSnapshot().revision
  })
  onBeforeUnmount(unsubscribe)

  return {
    translate(text, params) {
      void revision.value
      return locale.translate(text, params)
    },
    formatDate(value, options) {
      void revision.value
      return locale.formatDate(value, options)
    },
    formatNumber(value, options) {
      void revision.value
      return locale.formatNumber(value, options)
    },
  }
}

export function usePluginLocale<TKey extends string>(namespace: string): PluginTranslate<TKey> {
  const locale = useUiHostContext().locale
  const revision = shallowRef(locale.getSnapshot().revision)
  const translate = locale.bind<TKey>(namespace)
  const unsubscribe = locale.subscribe(() => {
    revision.value = locale.getSnapshot().revision
  })
  onBeforeUnmount(unsubscribe)

  return (key, params) => {
    void revision.value
    return translate(key, params)
  }
}

export function createVueInsightRouteRecords(runtime: InsightPluginRuntime): RouteRecordRaw[] {
  return runtime.listPages().map((page) => ({
    path: page.path,
    name: page.routeName,
    component: async (): Promise<Component> => {
      const loaded = await page.view.load()
      if (typeof loaded === 'object' && loaded !== null && 'default' in loaded) {
        return loaded.default as Component
      }
      return loaded as Component
    },
    meta: { insightPageId: page.id },
  }))
}
