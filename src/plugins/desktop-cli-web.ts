import { PLATFORM_CAPABILITIES } from '@/utils/platform-capabilities'
import { annualSummaryBuiltin } from './builtin/annual-summary'
import { getLegacyInsightPages } from './insight-catalog'
import { createStaticInsightPluginRuntime } from './static-insight'
import { UiServiceRegistry } from './ui-host'
import { createVueUiHostContext } from './vue-ui-host'

const platform = PLATFORM_CAPABILITIES.platform
export const desktopCliWebInsightBuiltins = [annualSummaryBuiltin] as const
export const desktopCliWebUiServices = new UiServiceRegistry()
export const desktopCliWebUiHost = createVueUiHostContext({ services: desktopCliWebUiServices })
export const desktopCliWebInsightRuntime = createStaticInsightPluginRuntime(
  platform,
  desktopCliWebUiHost,
  desktopCliWebUiHost.locale,
  desktopCliWebInsightBuiltins,
  getLegacyInsightPages(platform)
)
