<script setup lang="ts">
/**
 * 应用锁屏覆盖层
 *
 * 在主窗口内部以最高 z-index 遮罩形式覆盖所有业务页面。
 * 填满窗口可视区域，背景跟随全局主题（浅色/深色）。
 * 解锁前拦截软件内部全部操作。
 *
 * 由主进程通过 IPC (app-lock:overlay-command) 控制显隐。
 */

import { ref, onMounted, onUnmounted, computed, watch, nextTick } from 'vue'
import { useColorMode } from '@vueuse/core'

const colorMode = useColorMode({ emitAuto: true })
const isDark = computed(() => colorMode.value === 'dark')

// input refs — 程序化聚焦，保证手动锁屏时输入框获得焦点
const passwordInputRef = ref<HTMLInputElement | null>(null)
const setupInputRef = ref<HTMLInputElement | null>(null)
const setupConfirmRef = ref<HTMLInputElement | null>(null)

interface LockConfig {
  enabled: boolean
  unlockMode: 'password' | 'windows-hello'
  idleTimeoutMinutes: number
  lockOnBlur: boolean
  lockOnStartup: boolean
  hasPassword: boolean
  windowsHelloAvailable: boolean
}

// ==================== 显隐控制 ====================

const visible = ref(false)
let removeOverlayListener: (() => void) | null = null

// ==================== 业务状态 ====================

const config = ref<LockConfig | null>(null)
const isLoading = ref(false)
const isUnlocking = ref(false)
const password = ref('')
const showPassword = ref(false)
const errorMessage = ref('')
const cooldownRemaining = ref(0)
const remainingRetries = ref(5)

// 首次设置密码
const setupMode = ref(false)
const setupPassword = ref('')
const setupPasswordConfirm = ref('')
const setupError = ref('')
const setupStep = ref<'enter' | 'confirm'>('enter')
const setupSuccess = ref(false)

// ==================== 计算属性 ====================

const isLockedOut = computed(() => cooldownRemaining.value > 0)
const canUseWindowsHello = computed(() => config.value?.windowsHelloAvailable && config.value?.unlockMode === 'windows-hello')

const pageTitle = computed(() => {
  if (setupSuccess.value) return '密码设置成功'
  if (setupMode.value) return '设置应用锁密码'
  return 'ChatLab 已锁定'
})

const pageSubtitle = computed(() => {
  if (setupSuccess.value) return '应用已解锁，即将进入...'
  if (setupMode.value) return '首次使用，请设置解锁密码'
  return '请输入密码以解锁应用'
})

// ==================== 生命周期 ====================

let cooldownTimer: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  // 主通道：通过 securityApi 监听主进程锁状态变化
  removeOverlayListener = window.securityApi?.onLockStateChanged?.((data: { locked: boolean }) => {
    if (data.locked) showOverlay()
    else hideOverlay()
  }) ?? null

  // 兼容通道：直接监听 overlay-command（双保险）
  try {
    window.electron?.ipcRenderer?.on('app-lock:overlay-command', (_event: unknown, data: { command: string }) => {
      if (data.command === 'show') showOverlay()
      else hideOverlay()
    })
  } catch { /* preload may not expose ipcRenderer directly */ }

  // 启动时检查：若是崩溃恢复或已锁定状态，立即显示覆盖层
  try {
    const state = await window.securityApi?.getState()
    if (state?.state === 'locked') showOverlay()
  } catch { /* ignore */ }
})

onUnmounted(() => {
  removeOverlayListener?.()
  if (cooldownTimer) clearInterval(cooldownTimer)
})

async function showOverlay() {
  visible.value = true
  isLoading.value = true
  errorMessage.value = ''
  password.value = ''
  try {
    const cfg = await window.securityApi?.getConfig()
    if (cfg) {
      config.value = cfg
      if (!cfg.hasPassword) {
        setupMode.value = true
        setupStep.value = 'enter'
      }
    }
  } catch {
    errorMessage.value = '加载配置失败'
  } finally {
    isLoading.value = false
  }
}

// 加载完成后强制聚焦输入框 — 双层 nextTick + 短延时对抗外部焦点陷阱
watch(isLoading, async (val) => {
  if (!val && visible.value) {
    await nextTick()
    await nextTick()
    setTimeout(() => {
      if (setupMode.value) {
        setupStep.value === 'enter' ? setupInputRef.value?.focus() : setupConfirmRef.value?.focus()
      } else {
        passwordInputRef.value?.focus()
      }
    }, 100)
  }
})

function hideOverlay() {
  visible.value = false
  resetState()
}

function resetState() {
  password.value = ''
  errorMessage.value = ''
  cooldownRemaining.value = 0
  remainingRetries.value = 5
  setupMode.value = false
  setupPassword.value = ''
  setupPasswordConfirm.value = ''
  setupError.value = ''
  setupStep.value = 'enter'
  setupSuccess.value = false
  if (cooldownTimer) { clearInterval(cooldownTimer); cooldownTimer = null }
}

// ==================== 密码解锁 ====================

async function handleUnlock() {
  if (!password.value || isUnlocking.value || isLockedOut.value) return
  isUnlocking.value = true
  errorMessage.value = ''

  try {
    const result = await window.securityApi?.unlock({ password: password.value })
    if (result?.success) { password.value = ''; return }
    if (result?.cooldown) {
      cooldownRemaining.value = result.cooldownRemaining || 30
      startCooldownTimer()
      errorMessage.value = result.error || `验证次数过多，请 ${cooldownRemaining.value} 秒后重试`
    } else if (result?.wrongPassword) {
      remainingRetries.value = result.remainingRetries || 0
      errorMessage.value = result.error || '密码错误'
      password.value = ''
    } else {
      errorMessage.value = result?.error || '解锁失败'
    }
  } catch {
    errorMessage.value = '解锁失败，请重试'
  } finally {
    isUnlocking.value = false
  }
}

// ==================== Windows Hello 解锁 ====================

async function handleWindowsHelloUnlock() {
  if (isUnlocking.value || isLockedOut.value) return
  isUnlocking.value = true
  errorMessage.value = ''
  try {
    const result = await window.securityApi?.unlock({ useWindowsHello: true })
    // 1) 验证成功
    if (result?.success) return
    // 2) 设备不支持
    if (result?.windowsHelloUnavailable) {
      errorMessage.value = '此设备不支持 Windows Hello，请使用密码解锁'
    }
    // 3) 用户取消 — 不显示错误
    else if (result?.cancelled) {
      // 用户主动取消，清除错误提示
    }
    // 其他错误
    else {
      errorMessage.value = result?.error || 'Windows Hello 验证失败'
    }
  } catch {
    errorMessage.value = 'Windows Hello 验证失败，请使用密码解锁'
  } finally {
    isUnlocking.value = false
  }
}

// ==================== 密码设置 ====================

function goToConfirmStep() {
  if (setupPassword.value.length < 4) { setupError.value = '密码长度不能少于 4 位'; return }
  setupError.value = ''
  setupStep.value = 'confirm'
}
function goBackToEnter() { setupStep.value = 'enter'; setupPasswordConfirm.value = ''; setupError.value = '' }

async function handleSetPassword() {
  if (setupPassword.value !== setupPasswordConfirm.value) { setupError.value = '两次输入的密码不一致'; return }
  isUnlocking.value = true; setupError.value = ''
  try {
    const result = await window.securityApi?.setPassword(setupPassword.value)
    if (result?.success) {
      setupSuccess.value = true; setupMode.value = false
      setTimeout(async () => {
        setupSuccess.value = false
        setupPassword.value = ''; setupPasswordConfirm.value = ''
        const cfg = await window.securityApi?.getConfig()
        if (cfg) config.value = cfg
      }, 1500)
    } else { setupError.value = result?.error || '密码设置失败' }
  } catch { setupError.value = '密码设置失败，请重试' }
  finally { isUnlocking.value = false }
}

// ==================== 辅助 ====================

function startCooldownTimer() {
  if (cooldownTimer) clearInterval(cooldownTimer)
  cooldownTimer = setInterval(() => {
    if (cooldownRemaining.value > 0) cooldownRemaining.value--
    else { if (cooldownTimer) clearInterval(cooldownTimer); cooldownTimer = null }
  }, 1000)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    if (setupMode.value) { setupStep.value === 'enter' ? goToConfirmStep() : handleSetPassword() }
    else { handleUnlock() }
  }
}
</script>

<template>
  <div
    v-if="visible"
    class="absolute inset-0 z-[99999] flex items-center justify-center"
    style="pointer-events: auto"
    :class="isDark ? 'bg-gray-950' : 'bg-white'"
    @keydown="handleKeydown"
  >
    <!-- 加载中 -->
    <div v-if="isLoading" class="flex flex-col items-center gap-3">
      <div class="h-8 w-8 animate-spin rounded-full border-2 border-pink-500 border-t-transparent" />
      <p class="text-sm text-gray-400 dark:text-gray-500">正在加载...</p>
    </div>

    <!-- 主内容 -->
    <div v-else class="w-full max-w-sm px-8">
      <!-- Logo + 标题 -->
      <div class="mb-10 text-center">
        <div class="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-pink-500 to-purple-600 shadow-xl shadow-pink-500/30">
          <svg class="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h1 class="text-xl font-semibold tracking-tight text-gray-900 dark:text-white">{{ pageTitle }}</h1>
        <p class="mt-1.5 text-sm text-gray-500 dark:text-gray-400">{{ pageSubtitle }}</p>
      </div>

      <!-- 设置成功 -->
      <div v-if="setupSuccess" class="flex justify-center">
        <svg class="h-14 w-14 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>

      <!-- 密码设置 -->
      <div v-else-if="setupMode" class="space-y-3">
        <template v-if="setupStep === 'enter'">
          <input ref="setupInputRef" v-model="setupPassword" type="password" placeholder="设置解锁密码（至少 4 位）"
            class="w-full rounded-xl border px-4 py-3 text-sm placeholder-gray-400 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500 bg-gray-100 border-gray-200 text-gray-900 dark:bg-gray-900 dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
            maxlength="128" autofocus />
          <p v-if="setupError" class="text-center text-xs text-red-500">{{ setupError }}</p>
          <button class="w-full rounded-xl bg-pink-600 py-3 text-sm font-medium text-white transition-colors hover:bg-pink-700 disabled:opacity-50"
            :disabled="!setupPassword" @click="goToConfirmStep">继续</button>
        </template>
        <template v-else>
          <input ref="setupConfirmRef" v-model="setupPasswordConfirm" type="password" placeholder="再次输入密码确认"
            class="w-full rounded-xl border px-4 py-3 text-sm placeholder-gray-400 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500 bg-gray-100 border-gray-200 text-gray-900 dark:bg-gray-900 dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
            maxlength="128" autofocus />
          <p v-if="setupError" class="text-center text-xs text-red-500">{{ setupError }}</p>
          <div class="flex gap-2">
            <button class="flex-1 rounded-xl border py-3 text-sm font-medium transition-colors border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              @click="goBackToEnter">返回</button>
            <button class="flex-1 rounded-xl bg-pink-600 py-3 text-sm font-medium text-white transition-colors hover:bg-pink-700 disabled:opacity-50"
              :disabled="!setupPasswordConfirm || isUnlocking" @click="handleSetPassword">{{ isUnlocking ? '设置中...' : '确认' }}</button>
          </div>
        </template>
      </div>

      <!-- 解锁表单 -->
      <div v-else class="space-y-3">
        <!-- 密码输入 -->
        <div class="relative">
          <input ref="passwordInputRef" v-model="password" :type="showPassword ? 'text' : 'password'" placeholder="输入密码"
            tabindex="0"
            class="w-full rounded-xl border py-3 pl-4 pr-12 text-sm placeholder-gray-400 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500 disabled:opacity-40 bg-gray-100 border-gray-200 text-gray-900 dark:bg-gray-900 dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
            :disabled="isLockedOut || isUnlocking" maxlength="128" autofocus />
          <button type="button"
            class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300"
            :disabled="isLockedOut || isUnlocking" @click="showPassword = !showPassword">
            <svg v-if="!showPassword" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            <svg v-else class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M15 12a3 3 0 01-4.16 2.85M19.5 12c-.992 1.914-2.43 3.47-4.17 4.52L9.83 8" />
            </svg>
          </button>
        </div>

        <!-- 状态提示 -->
        <p v-if="errorMessage" class="text-center text-xs" :class="isLockedOut ? 'text-amber-500' : 'text-red-500'">{{ errorMessage }}</p>
        <p v-else-if="!isLockedOut && remainingRetries < 5 && remainingRetries > 0" class="text-center text-xs text-gray-400 dark:text-gray-500">还剩 {{ remainingRetries }} 次尝试机会</p>

        <!-- 解锁按钮 -->
        <button
          class="flex w-full items-center justify-center gap-2 rounded-xl bg-pink-600 py-3 text-sm font-medium text-white transition-colors hover:bg-pink-700 disabled:opacity-50"
          :disabled="!password || isUnlocking || isLockedOut" @click="handleUnlock">
          <template v-if="isUnlocking">
            <svg class="h-4 w-4 animate-spin text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            验证中...
          </template>
          <template v-else>
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            解锁
          </template>
        </button>

        <!-- 冷却倒计时 -->
        <p v-if="isLockedOut" class="text-center text-sm text-amber-500">{{ cooldownRemaining }} 秒后可重试</p>

        <!-- Windows Hello -->
        <button v-if="canUseWindowsHello"
          class="flex w-full items-center justify-center gap-2 rounded-xl border py-3 text-sm font-medium transition-colors disabled:opacity-50 border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:border-gray-500 dark:hover:bg-gray-800"
          :disabled="isUnlocking || isLockedOut" @click="handleWindowsHelloUnlock">
          <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="10" width="18" height="11" rx="2" />
            <path d="M7 10V7a5 5 0 0110 0v3" stroke-linecap="round" />
            <circle cx="12" cy="16" r="1.5" fill="currentColor" stroke="none" />
            <path d="M12 17.5v2" stroke-linecap="round" />
          </svg>
          Windows Hello
        </button>
      </div>
    </div>
  </div>
</template>
