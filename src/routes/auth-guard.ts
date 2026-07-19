export interface AuthNavigationContext {
  requiresAuth: boolean
  routeName: unknown
  fullPath: string
  isPublic: boolean
  authRequired: boolean
  isAuthenticated: boolean
}

export type AuthNavigationTarget = { name: 'home' } | { name: 'login'; query: { redirect: string } } | null

export function resolveAuthNavigation(context: AuthNavigationContext): AuthNavigationTarget {
  if (!context.requiresAuth) {
    return context.routeName === 'login' ? { name: 'home' } : null
  }

  if (context.isPublic) return null
  if (context.authRequired && !context.isAuthenticated) {
    return { name: 'login', query: { redirect: context.fullPath } }
  }
  return null
}
