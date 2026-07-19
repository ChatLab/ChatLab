import { createRouter, createWebHashHistory } from 'vue-router'
import { webWasmRoutes } from './routes'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: webWasmRoutes,
})

router.afterEach((to) => {
  document.body.id = `page-${String(to.name ?? 'unknown')}`
})
