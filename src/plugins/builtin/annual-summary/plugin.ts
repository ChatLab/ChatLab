import type { InsightPlugin } from '../../insight'
import type { StaticInsightPluginDescriptor } from '../../static-insight'
import { ANNUAL_SUMMARY_LOCALE_NAMESPACE, ANNUAL_SUMMARY_PLUGIN_ID } from './constants'
import { annualSummaryLocaleMessages } from './locales'

export const annualSummaryPlugin: InsightPlugin = {
  id: ANNUAL_SUMMARY_PLUGIN_ID,
  platforms: ['electron', 'cli-web'],
  activate(context) {
    context.locale.register(ANNUAL_SUMMARY_LOCALE_NAMESPACE, annualSummaryLocaleMessages)
    context.pages.register({
      id: 'annual-summary',
      path: 'annual-summary',
      routeName: 'insight-annual-summary',
      title: { namespace: ANNUAL_SUMMARY_LOCALE_NAMESPACE, key: 'title' },
      icon: 'i-lucide-calendar-range',
      default: true,
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
      id: 'insight.annual-summary',
      pageId: 'annual-summary',
      order: 10,
    })
  },
}

export const annualSummaryBuiltin: StaticInsightPluginDescriptor = {
  plugin: annualSummaryPlugin,
  installUiServices: async (services) => {
    const { registerAnnualSummaryUiService } = await import('./host')
    return registerAnnualSummaryUiService(services)
  },
}
