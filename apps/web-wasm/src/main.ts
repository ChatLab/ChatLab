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
import { WebWasmSessionSync } from './session-sync'
import { useSessionStore } from '@/stores/session'
import { initializeWebWasmLocale } from './locale-bootstrap'
import '@/assets/styles/main.css'

initializeWebWasmLocale()

async function start(): Promise<void> {
  reportRuntimeLog({ level: 'info', scope: 'web-wasm-bootstrap', message: 'Initializing Web WASM services' })
  installGlobalErrorReporting()
  const sessionSync = new WebWasmSessionSync()
  await initServices({
    initializeWebWasm: (registry) =>
      registerWebWasmAdapters({
        ...registry,
        onWorkspaceChanged: (event) => sessionSync.publish(event),
      }),
  })

  const runtime = useBrowserRuntimeService()

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

  const sessionStore = useSessionStore(pinia)
  let refreshRequested = false
  let refreshInProgress = false
  const refreshSessions = async () => {
    refreshRequested = true
    if (refreshInProgress) return
    refreshInProgress = true
    try {
      // 连续收到多个标签页事件时至少执行到最后一次，避免导入/重命名紧邻发生时漏掉最新状态。
      while (refreshRequested) {
        refreshRequested = false
        await sessionStore.loadSessions()
      }
    } finally {
      refreshInProgress = false
    }
  }
  const unsubscribeSessionSync = sessionSync.subscribe(() => {
    void refreshSessions()
  })

  window.addEventListener('pagehide', (event) =>
    handleWebWasmPageHide(event, () => {
      unsubscribeSessionSync()
      sessionSync.dispose()
      runtime.dispose()
    })
  )
  app.mount('#app')
}

start().catch((error) => {
  console.error('Web WASM startup failed', error)
  reportError(error instanceof Error ? error.message : String(error), error instanceof Error ? error.stack : undefined)
  const root = document.querySelector<HTMLElement>('#app')
  if (root) root.textContent = error instanceof Error ? error.message : String(error)
})
