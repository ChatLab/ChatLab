import { watch } from 'vue'
import { getLocale, i18n, type LocaleType } from '@/i18n'
import type { Disposer } from './core'
import { InsightScopeController } from './insight-scope'
import { PluginLocaleHost } from './locale'
import { UiServiceRegistry, type UiHostContext, type UiServiceProvider } from './ui-host'

function subscribeToLocale(listener: () => void): Disposer {
  return watch(i18n.global.locale, listener)
}

function currentLocale(): LocaleType {
  return getLocale()
}

export interface CreateVueUiHostContextOptions {
  services?: UiServiceProvider
  insightScope?: InsightScopeController
}

export interface VueUiHostContext extends UiHostContext {
  locale: PluginLocaleHost
}

export function createVueUiHostContext(options: CreateVueUiHostContextOptions = {}): VueUiHostContext {
  const locale = new PluginLocaleHost({
    getLocale: currentLocale,
    subscribe: subscribeToLocale,
    translate: (key, params) => i18n.global.t(key, params ?? {}),
  })

  return {
    locale,
    insightScope: options.insightScope ?? new InsightScopeController(),
    services: options.services ?? new UiServiceRegistry(),
  }
}
