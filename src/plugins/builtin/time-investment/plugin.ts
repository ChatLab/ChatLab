import type { InsightPlugin } from '../../insight'
import type { StaticInsightPluginDescriptor } from '../../static-insight'
import { TIME_INVESTMENT_LOCALE_NAMESPACE, TIME_INVESTMENT_PLUGIN_ID } from './constants'
import { timeInvestmentLocaleMessages } from './locales'

export const timeInvestmentPlugin: InsightPlugin = {
  id: TIME_INVESTMENT_PLUGIN_ID,
  platforms: ['electron', 'cli-web', 'web-wasm'],
  activate(context) {
    context.locale.register(TIME_INVESTMENT_LOCALE_NAMESPACE, timeInvestmentLocaleMessages)
    context.pages.register({
      id: 'time-investment',
      path: 'time-investment',
      routeName: 'insight-time-investment',
      title: { namespace: TIME_INVESTMENT_LOCALE_NAMESPACE, key: 'title' },
      icon: 'i-lucide-clock-3',
      filters: {
        time: {
          allowedModes: ['recent', 'year'],
          allowedRecentDays: [365],
          defaultMode: 'year',
        },
      },
      view: {
        load: () => import('./ui/index.vue'),
      },
    })
    context.navigation.register({
      id: 'insight.time-investment',
      pageId: 'time-investment',
      order: 20,
    })
  },
}

export const timeInvestmentBuiltin: StaticInsightPluginDescriptor = {
  plugin: timeInvestmentPlugin,
  installUiServices: async (services) => {
    const { registerTimeInvestmentUiService } = await import('./host')
    registerTimeInvestmentUiService(services)
  },
}
