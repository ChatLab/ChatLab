import { createApp } from 'vue'
import App from './App.vue'
import { router } from './routes/'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { backendPersistPlugin } from '@/plugins/backendPersist'
import ui from '@nuxt/ui/vue-plugin'
import i18n from './i18n'
import './assets/styles/main.css'
import { installGlobalErrorReporting, reportError } from './services/log-report'

installGlobalErrorReporting()

const app = createApp(App)

// Report uncaught component errors; keep Vue's default console output too.
app.config.errorHandler = (err, _instance, info) => {
  const e = err as Error
  console.error(e, info)
  reportError(e?.message ?? String(err), e?.stack)
}

const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)
pinia.use(backendPersistPlugin)

app.use(pinia)
app.use(router)
app.use(ui)
app.use(i18n)

app.mount('#app')
