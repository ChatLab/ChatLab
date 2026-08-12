import type { RouteRecordRaw } from 'vue-router'
import { desktopCliWebInsightRuntime } from '@/plugins/desktop-cli-web'
import type { InsightPluginRuntime } from '@/plugins/insight'
import { listInsightShellPages } from '@/plugins/insight-catalog'
import { createVueInsightRouteRecords } from '@/plugins/insight-vue'

/** 开发模式按需加载页面，避免失败的预加载请求污染后续动态路由导航。 */
export function shouldPreloadCriticalRoutes(isProduction: boolean): boolean {
  return isProduction
}

export function createAppRoutes(insightRuntime: InsightPluginRuntime = desktopCliWebInsightRuntime): RouteRecordRaw[] {
  const defaultInsightRoute =
    insightRuntime.getDefaultPage()?.routeName ?? listInsightShellPages(insightRuntime)[0]?.routeName

  return [
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
    {
      path: '/insight',
      component: () => import('@/pages/insight/index.vue'),
      redirect: defaultInsightRoute ? { name: defaultInsightRoute } : undefined,
      children: [
        ...createVueInsightRouteRecords(insightRuntime),
        {
          path: 'relationship-changes',
          name: 'insight-relationship-changes',
          component: () => import('@/pages/insight/relationship-changes/index.vue'),
          meta: { insightPageId: 'relationship-changes' },
        },
      ],
    },
    {
      path: '/people',
      component: () => import('@/pages/people/index.vue'),
      redirect: { name: 'people-contacts' },
      children: [
        {
          path: 'contacts',
          name: 'people-contacts',
          component: () => import('@/pages/people/contacts/index.vue'),
        },
        {
          path: 'relationships',
          name: 'people-relationships',
          component: () => import('@/pages/people/relationships/index.vue'),
        },
      ],
    },
  ]
}

export const appRoutes = createAppRoutes()
