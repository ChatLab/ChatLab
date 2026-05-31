/**
 * Auth Store — Server 模式下的 token 管理
 *
 * 仅在 CLI Web (web-serve) 模式下生效。
 * Electron 模式不需要认证（通过 preload 获取 ephemeral token）。
 */

import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

const TOKEN_KEY = 'chatlab_auth_token'

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem(TOKEN_KEY) || '')

  const isAuthenticated = computed(() => !!token.value)

  function login(newToken: string) {
    token.value = newToken
    localStorage.setItem(TOKEN_KEY, newToken)
  }

  function logout() {
    token.value = ''
    localStorage.removeItem(TOKEN_KEY)
  }

  return { token, isAuthenticated, login, logout }
})
