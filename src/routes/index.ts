import { createRouter, createWebHashHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { PLATFORM_CAPABILITIES } from '@/utils/platform-capabilities'
import { resolveAuthNavigation } from './auth-guard'
import { appRoutes, shouldPreloadCriticalRoutes } from './routes'

export const router = createRouter({
  routes: appRoutes,
  history: createWebHashHistory(),
})

router.beforeEach((to, _from, next) => {
  const authStore = useAuthStore()
  const target = resolveAuthNavigation({
    requiresAuth: PLATFORM_CAPABILITIES.requiresAuth,
    routeName: to.name,
    fullPath: to.fullPath,
    isPublic: to.meta.public === true,
    authRequired: authStore.requiresAuth,
    isAuthenticated: authStore.isAuthenticated,
  })
  if (target) return next(target)
  return next()
})

router.afterEach((to) => {
  document.body.id = `page-${to.name as string}`
})

/**
 * 预加载关键路由组件
 */
function preloadCriticalRoutes() {
  requestIdleCallback(() => {
    import('@/pages/group-chat/index.vue')
    import('@/pages/private-chat/index.vue')
    import('@/pages/people/contacts/index.vue')
  })
}

if (shouldPreloadCriticalRoutes(import.meta.env.PROD)) {
  router.isReady().then(preloadCriticalRoutes)
}
