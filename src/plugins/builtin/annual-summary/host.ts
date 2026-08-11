import { watch } from 'vue'
import { useDataService } from '@/services'
import { useLayoutStore } from '@/stores/layout'
import { ANNUAL_SUMMARY_UI_SERVICE, type AnnualSummaryUiService } from './service'
import type { UiServiceRegistrar } from '../../ui-host'

export function createAnnualSummaryUiService(): AnnualSummaryUiService {
  return {
    get: (options) => useDataService().getAnnualSummary(options),
    recompute: (options) => useDataService().recomputeAnnualSummary(options),
    openOwnerSettings: () => useLayoutStore().openSettings('data', 'missing-owner'),
    subscribeOwnerSettingsClosed: (listener) => {
      const layoutStore = useLayoutStore()
      return watch(
        () => layoutStore.showSettings,
        (visible, wasVisible) => {
          if (wasVisible && !visible) listener()
        }
      )
    },
  }
}

export function registerAnnualSummaryUiService(services: UiServiceRegistrar): void {
  services.register(ANNUAL_SUMMARY_UI_SERVICE, createAnnualSummaryUiService())
}
