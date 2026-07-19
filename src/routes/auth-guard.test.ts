import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveAuthNavigation } from './auth-guard'

test('redirects CLI Web users to login when authentication is required', () => {
  assert.deepEqual(
    resolveAuthNavigation({
      requiresAuth: true,
      routeName: 'home',
      fullPath: '/',
      isPublic: false,
      authRequired: true,
      isAuthenticated: false,
    }),
    { name: 'login', query: { redirect: '/' } }
  )
})

test('does not require CLI Web authentication for backend-free platforms', () => {
  assert.equal(
    resolveAuthNavigation({
      requiresAuth: false,
      routeName: 'group-chat',
      fullPath: '/group-chat/session-1',
      isPublic: false,
      authRequired: true,
      isAuthenticated: false,
    }),
    null
  )
})

test('redirects login away on platforms that do not require authentication', () => {
  assert.deepEqual(
    resolveAuthNavigation({
      requiresAuth: false,
      routeName: 'login',
      fullPath: '/login',
      isPublic: true,
      authRequired: false,
      isAuthenticated: false,
    }),
    { name: 'home' }
  )
})
