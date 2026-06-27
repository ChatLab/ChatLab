import type { RouteRecordRaw } from 'vue-router'

export const appRoutes: RouteRecordRaw[] = [
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
