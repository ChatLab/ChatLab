import { watch } from 'vue'
import { useDataService } from '@/services'
import { useLayoutStore } from '@/stores/layout'
import { PLATFORM_CAPABILITIES } from '@/utils/platform-capabilities'
import type { UiServiceRegistrar } from '../../ui-host'
import { TIME_INVESTMENT_UI_SERVICE, type TimeInvestmentUiService } from './service'

export function createTimeInvestmentUiService(): TimeInvestmentUiService {
  return {
    canConfigureOwner: !PLATFORM_CAPABILITIES.usesBrowserRuntime,
    get: (options) => useDataService().getTimeInvestment(options),
    recompute: (options) => useDataService().recomputeTimeInvestment(options),
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

export function registerTimeInvestmentUiService(services: UiServiceRegistrar): void {
  services.register(TIME_INVESTMENT_UI_SERVICE, createTimeInvestmentUiService())
}
