/**
 * Auth Store — Server 模式下的 token 管理
 *
 * 仅在 CLI Web 模式下生效。
 * Electron 模式不需要认证（通过 preload 获取 ephemeral token）。
 *
 * 默认使用 sessionStorage（关闭浏览器后清除）。
 * 勾选「记住此设备」后写入 localStorage，跨会话保留。
 * requiresAuth 仅内存态——避免服务器重启为免登录模式后路由守卫仍强制跳登录。
 */

import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

const TOKEN_KEY = 'chatlab_auth_token'
const REMEMBER_KEY = 'chatlab_remember_device'

export const useAuthStore = defineStore('auth', () => {
  const token = ref(sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || '')
  const rememberDevice = ref(!!localStorage.getItem(REMEMBER_KEY))
  // In-memory only: auto-cleared on page reload to avoid stale guard
  const requiresAuth = ref(false)

  const isAuthenticated = computed(() => !!token.value)

  function markRequiresAuth() {
    requiresAuth.value = true
  }

  function login(newToken: string, remember: boolean) {
    token.value = newToken
    rememberDevice.value = remember
    markRequiresAuth()

    if (remember) {
      localStorage.setItem(TOKEN_KEY, newToken)
      localStorage.setItem(REMEMBER_KEY, '1')
      sessionStorage.removeItem(TOKEN_KEY)
    } else {
      sessionStorage.setItem(TOKEN_KEY, newToken)
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(REMEMBER_KEY)
    }
  }

  function logout() {
    token.value = ''
    rememberDevice.value = false
    requiresAuth.value = false
    sessionStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(REMEMBER_KEY)
  }

  return { token, requiresAuth, rememberDevice, isAuthenticated, login, logout, markRequiresAuth }
})
