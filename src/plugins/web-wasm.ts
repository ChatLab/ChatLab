import { createInsightPluginRuntime } from './insight'
import { getLegacyInsightPages } from './insight-catalog'
import { createVueUiHostContext } from './vue-ui-host'

export const webWasmUiHost = createVueUiHostContext()
export const webWasmInsightRuntime = createInsightPluginRuntime(
  'web-wasm',
  webWasmUiHost,
  webWasmUiHost.locale,
  [],
  getLegacyInsightPages('web-wasm')
)
