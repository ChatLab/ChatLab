import '@/icons/disable-iconify-api'
import 'virtual:nuxt-icon-bundle/register'

import { createApp } from 'vue'
import ui from '@nuxt/ui/vue-plugin'
import { createMemoryHistory, createRouter } from 'vue-router'
import i18n from '@/i18n'
import BenchmarkApp from './BenchmarkApp.vue'
import '@/assets/styles/main.css'

const router = createRouter({ history: createMemoryHistory(), routes: [] })

createApp(BenchmarkApp).use(router).use(ui).use(i18n).mount('#app')
