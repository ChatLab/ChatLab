import type { RouteRecordRaw } from 'vue-router'
import { createVueInsightRouteRecords } from '@/plugins/insight-vue'
import { webWasmInsightRuntime } from '@/plugins/web-wasm'

const defaultInsightRoute =
  webWasmInsightRuntime.getDefaultPage()?.routeName ?? webWasmInsightRuntime.listPages()[0]?.routeName

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
    redirect: defaultInsightRoute ? { name: defaultInsightRoute } : undefined,
    children: createVueInsightRouteRecords(webWasmInsightRuntime),
  },
]
