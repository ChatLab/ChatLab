import { timeInvestmentBuiltin } from './builtin/time-investment'
import { getLegacyInsightPages } from './insight-catalog'
import { createStaticInsightPluginRuntime } from './static-insight'
import { UiServiceRegistry } from './ui-host'
import { createVueUiHostContext } from './vue-ui-host'

export const webWasmInsightBuiltins = [timeInvestmentBuiltin] as const
export const webWasmUiServices = new UiServiceRegistry()
export const webWasmUiHost = createVueUiHostContext({ services: webWasmUiServices })
export const webWasmInsightRuntime = createStaticInsightPluginRuntime(
  'web-wasm',
  webWasmUiHost,
  webWasmUiHost.locale,
  webWasmInsightBuiltins,
  getLegacyInsightPages('web-wasm')
)
