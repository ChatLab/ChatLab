import { createRouter, createWebHashHistory } from 'vue-router'

export const router = createRouter({
  routes: [
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
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/pages/settings/index.vue'),
    },
  ],
  history: createWebHashHistory(),
})

router.beforeEach((_to, _from, next) => {
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
    // 预加载聊天分析页面（最常访问的路由）
    import('@/pages/group-chat/index.vue')
    import('@/pages/private-chat/index.vue')
  })
}

// 路由准备就绪后触发预加载
router.isReady().then(preloadCriticalRoutes)
