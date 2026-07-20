import '@/icons/disable-iconify-api'
import 'virtual:nuxt-icon-bundle/register'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import ui from '@nuxt/ui/vue-plugin'
import App from './App.vue'
import { router } from './router'
import i18n from '@/i18n'
import { backendPersistPlugin } from '@/plugins/backendPersist'
import { useBrowserRuntimeService } from '@/services/browser-runtime/service'
import { installGlobalErrorReporting, reportError, reportRuntimeLog } from '@/services/log-report'
import { initServices } from '@/services/registry'
import { registerWebWasmAdapters } from '@/services/browser-runtime/register'
import { handleWebWasmPageHide } from './runtime-lifecycle'
import '@/assets/styles/main.css'

async function start(): Promise<void> {
  reportRuntimeLog({ level: 'info', scope: 'web-wasm-bootstrap', message: 'Initializing Web WASM services' })
  installGlobalErrorReporting()
  await initServices({ initializeWebWasm: registerWebWasmAdapters })

  const runtime = useBrowserRuntimeService()
  window.addEventListener('pagehide', (event) => handleWebWasmPageHide(event, () => runtime.dispose()))

  const app = createApp(App)
  app.config.errorHandler = (error, _instance, info) => {
    const normalized = error instanceof Error ? error : new Error(String(error))
    console.error(normalized, info)
    reportError(normalized.message, normalized.stack)
  }

  const pinia = createPinia()
  pinia.use(piniaPluginPersistedstate)
  pinia.use(backendPersistPlugin)

  app.use(pinia)
  app.use(router)
  app.use(ui)
  app.use(i18n)
  app.mount('#app')
}

start().catch((error) => {
  console.error('Web WASM startup failed', error)
  reportError(error instanceof Error ? error.message : String(error), error instanceof Error ? error.stack : undefined)
  const root = document.querySelector<HTMLElement>('#app')
  if (root) root.textContent = error instanceof Error ? error.message : String(error)
})
