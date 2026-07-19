import { createApp } from 'vue'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import ui from '@nuxt/ui/vue-plugin'
import App from '@/App.vue'
import { router } from '@/routes'
import i18n from '@/i18n'
import { backendPersistPlugin } from '@/plugins/backendPersist'
import { installGlobalErrorReporting, reportError } from '@/services/log-report'
import '@/assets/styles/main.css'

export interface MountChatLabAppOptions {
  beforeMount?: () => void | Promise<void>
}

export async function mountChatLabApp(options: MountChatLabAppOptions = {}): Promise<void> {
  installGlobalErrorReporting()
  await options.beforeMount?.()

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
