import type { RouteRecordRaw } from 'vue-router'

export const webWasmRoutes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('./pages/HomePage.vue'),
  },
  {
    path: '/group-chat/:id',
    name: 'group-chat',
    component: () => import('./pages/SessionDetailPage.vue'),
  },
  {
    path: '/private-chat/:id',
    name: 'private-chat',
    component: () => import('./pages/SessionDetailPage.vue'),
  },
  {
    path: '/insight',
    component: () => import('@/pages/insight/index.vue'),
    redirect: { name: 'insight-time-investment' },
    children: [
      {
        path: 'time-investment',
        name: 'insight-time-investment',
        component: () => import('@/pages/insight/time-investment/index.vue'),
        meta: { insightPageId: 'time-investment' },
      },
    ],
  },
]
