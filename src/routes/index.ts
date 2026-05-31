import { createRouter, createWebHashHistory } from 'vue-router'
import { IS_ELECTRON } from '@/utils/platform'
import { useAuthStore } from '@/stores/auth'

export const router = createRouter({
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/pages/login/index.vue'),
      meta: { public: true },
    },
    {
      path: '/',
      name: 'home',
      component: () => import('@/pages/home/index.vue'),
    },
    {
      path: '/group-chat/:id',
      name: 'group-chat',
      component: () => import('@/pages/group-chat/index.vue'),
    },
    {
      path: '/private-chat/:id',
      name: 'private-chat',
      component: () => import('@/pages/private-chat/index.vue'),
    },
  ],
  history: createWebHashHistory(),
})

router.beforeEach((to, _from, next) => {
  // Electron never needs web login
  if (IS_ELECTRON) {
    return to.name === 'login' ? next({ name: 'home' }) : next()
  }

  if (to.meta.public) return next()

  const authStore = useAuthStore()
  if (authStore.requiresAuth && !authStore.isAuthenticated) {
    return next({ name: 'login', query: { redirect: to.fullPath } })
  }

  next()
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
  })
}

router.isReady().then(preloadCriticalRoutes)
