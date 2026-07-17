<script setup lang="ts">
/**
 * 应用锁屏覆盖层
 *
 * 全量 i18n 国际化，支持简体中文/English/繁體中文/日本語。
 * 由主进程 IPC 控制显隐，填满主窗口，最高 z-index。
 */

import { ref, onMounted, onUnmounted, computed, watch, nextTick } from 'vue'
import { useColorMode } from '@vueuse/core'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const colorMode = useColorMode({ emitAuto: true })
const isDark = computed(() => colorMode.value === 'dark')

interface LockConfig {
  enabled: boolean; unlockMode: 'password' | 'windows-hello'
  idleTimeoutMinutes: number; lockOnBlur: boolean; lockOnStartup: boolean
  hasPassword: boolean; windowsHelloAvailable: boolean
}

const visible = ref(false)
const config = ref<LockConfig | null>(null)
const isLoading = ref(false)
const isUnlocking = ref(false)
const password = ref('')
const showPassword = ref(false)
const errorMessage = ref('')
const cooldownRemaining = ref(0)
const remainingRetries = ref(5)

const setupMode = ref(false)
const setupPassword = ref('')
const setupPasswordConfirm = ref('')
const setupError = ref('')
const setupStep = ref<'enter' | 'confirm'>('enter')
const setupSuccess = ref(false)

const passwordInputRef = ref<HTMLInputElement | null>(null)
const setupInputRef = ref<HTMLInputElement | null>(null)
const setupConfirmRef = ref<HTMLInputElement | null>(null)

const isLockedOut = computed(() => cooldownRemaining.value > 0)
const canUseWindowsHello = computed(() => config.value?.windowsHelloAvailable && config.value?.unlockMode === 'windows-hello')

const pageTitle = computed(() => {
  if (setupSuccess.value) return t('settings.security.lockScreen.titleSuccess')
  if (setupMode.value) return t('settings.security.lockScreen.titleSetup')
  return t('settings.security.lockScreen.titleLocked')
})

const pageSubtitle = computed(() => {
  if (setupSuccess.value) return t('settings.security.lockScreen.subtitleSuccess')
  if (setupMode.value) return t('settings.security.lockScreen.subtitleSetup')
  return t('settings.security.lockScreen.subtitleLocked')
})

let cooldownTimer: ReturnType<typeof setInterval> | null = null
let removeOverlayListener: (() => void) | null = null

onMounted(async () => {
  removeOverlayListener = window.securityApi?.onLockStateChanged?.((data: { locked: boolean }) => {
    data.locked ? showOverlay() : hideOverlay()
  }) ?? null
  try {
    window.electron?.ipcRenderer?.on('app-lock:overlay-command', (_event: unknown, data: { command: string }) => {
      data.command === 'show' ? showOverlay() : hideOverlay()
    })
  } catch { /* ignore */ }
  try {
    const state = await window.securityApi?.getState()
    // locked / recovery-locked 均需展示锁屏遮罩（fail-closed）
    if (state?.state === 'locked' || state?.state === 'recovery-locked') showOverlay()
  } catch { /* ignore */ }
})

onUnmounted(() => { removeOverlayListener?.(); if (cooldownTimer) clearInterval(cooldownTimer) })

async function showOverlay() {
  visible.value = true; isLoading.value = true; errorMessage.value = ''; password.value = ''
  try {
    const cfg = await window.securityApi?.getConfig()
    if (cfg) { config.value = cfg; if (!cfg.hasPassword) { setupMode.value = true; setupStep.value = 'enter' } }
  } catch { errorMessage.value = t('settings.security.lockScreen.errorLoadConfig') }
  finally { isLoading.value = false }
}

function hideOverlay() { visible.value = false; resetState() }
function resetState() {
  password.value = ''; errorMessage.value = ''; cooldownRemaining.value = 0; remainingRetries.value = 5
  setupMode.value = false; setupPassword.value = ''; setupPasswordConfirm.value = ''; setupError.value = ''; setupStep.value = 'enter'; setupSuccess.value = false
  if (cooldownTimer) { clearInterval(cooldownTimer); cooldownTimer = null }
}

watch(isLoading, async (val) => {
  if (!val && visible.value) { await nextTick(); await nextTick(); setTimeout(() => {
    if (setupMode.value) { setupStep.value === 'enter' ? setupInputRef.value?.focus() : setupConfirmRef.value?.focus() }
    else { passwordInputRef.value?.focus() }
  }, 100) }
})

async function handleUnlock() {
  if (!password.value || isUnlocking.value || isLockedOut.value) return
  isUnlocking.value = true; errorMessage.value = ''
  try {
    const result = await window.securityApi?.unlock({ password: password.value })
    if (result?.success) { password.value = ''; return }
    if (result?.cooldown) { cooldownRemaining.value = result.cooldownRemaining || 30; startCooldownTimer(); errorMessage.value = result.error || `${cooldownRemaining.value} ${t('settings.security.lockScreen.cooldownPrefix')}` }
    else if (result?.wrongPassword) { remainingRetries.value = result.remainingRetries || 0; errorMessage.value = result.error || t('settings.security.lockScreen.errorService'); password.value = '' }
    else { errorMessage.value = result?.error || t('settings.security.lockScreen.errorService') }
  } catch { errorMessage.value = t('settings.security.lockScreen.errorService') }
  finally { isUnlocking.value = false }
}

async function handleWindowsHelloUnlock() {
  if (isUnlocking.value || isLockedOut.value) return
  isUnlocking.value = true; errorMessage.value = ''
  try {
    const result = await window.securityApi?.unlock({ useWindowsHello: true })
    if (result?.success) return
    if (result?.windowsHelloUnavailable) { errorMessage.value = t('settings.security.lockScreen.errorHelloUnavailable') }
    else if (!result?.cancelled) { errorMessage.value = result?.error || t('settings.security.lockScreen.errorHelloFail') }
  } catch { errorMessage.value = t('settings.security.lockScreen.errorHelloFail') }
  finally { isUnlocking.value = false }
}

function goToConfirmStep() {
  if (setupPassword.value.length < 4) { setupError.value = t('settings.security.lockScreen.errorTooShort'); return }
  if (setupPassword.value.length > 128) { setupError.value = t('settings.security.lockScreen.errorTooLong'); return }
  setupError.value = ''; setupStep.value = 'confirm'
}
function goBackToEnter() { setupStep.value = 'enter'; setupPasswordConfirm.value = ''; setupError.value = '' }

async function handleSetPassword() {
  if (setupPassword.value !== setupPasswordConfirm.value) { setupError.value = t('settings.security.lockScreen.errorMismatch'); return }
  isUnlocking.value = true; setupError.value = ''
  try {
    const result = await window.securityApi?.setPassword(setupPassword.value)
    if (result?.success) { setupSuccess.value = true; setupMode.value = false; setTimeout(async () => { setupSuccess.value = false; setupPassword.value = ''; setupPasswordConfirm.value = ''; const cfg = await window.securityApi?.getConfig(); if (cfg) config.value = cfg }, 1500) }
    else { setupError.value = result?.error || t('settings.security.lockScreen.errorService') }
  } catch { setupError.value = t('settings.security.lockScreen.errorService') }
  finally { isUnlocking.value = false }
}

function startCooldownTimer() { if (cooldownTimer) clearInterval(cooldownTimer); cooldownTimer = setInterval(() => { if (cooldownRemaining.value > 0) cooldownRemaining.value--; else { if (cooldownTimer) clearInterval(cooldownTimer); cooldownTimer = null } }, 1000) }

function handleKeydown(event: KeyboardEvent) { if (event.key === 'Enter') { if (setupMode.value) { setupStep.value === 'enter' ? goToConfirmStep() : handleSetPassword() } else { handleUnlock() } } }
</script>

<template>
  <div v-if="visible" class="absolute inset-0 z-[99999] flex items-center justify-center" style="pointer-events: auto" :class="isDark ? 'bg-gray-950' : 'bg-white'" @keydown="handleKeydown">
    <div v-if="isLoading" class="flex flex-col items-center gap-3">
      <div class="h-8 w-8 animate-spin rounded-full border-2 border-pink-500 border-t-transparent" />
      <p class="text-sm text-gray-400 dark:text-gray-500">{{ t('settings.security.lockScreen.loading') }}</p>
    </div>
    <div v-else class="w-full max-w-sm px-8">
      <div class="mb-10 text-center">
        <div class="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-pink-500 to-purple-600 shadow-xl shadow-pink-500/30">
          <svg class="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
        </div>
        <h1 class="text-xl font-semibold tracking-tight text-gray-900 dark:text-white">{{ pageTitle }}</h1>
        <p class="mt-1.5 text-sm text-gray-500 dark:text-gray-400">{{ pageSubtitle }}</p>
      </div>

      <div v-if="setupSuccess" class="flex justify-center">
        <svg class="h-14 w-14 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
      </div>

      <div v-else-if="setupMode" class="space-y-3">
        <template v-if="setupStep === 'enter'">
          <input ref="setupInputRef" v-model="setupPassword" type="password" :placeholder="t('settings.security.lockScreen.placeholderSetup')" class="w-full rounded-xl border px-4 py-3 text-sm placeholder-gray-400 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500 bg-gray-100 border-gray-200 text-gray-900 dark:bg-gray-900 dark:border-gray-700 dark:text-white dark:placeholder-gray-500" maxlength="128" autofocus />
          <p v-if="setupError" class="text-center text-xs text-red-500">{{ setupError }}</p>
          <button class="w-full rounded-xl bg-pink-600 py-3 text-sm font-medium text-white transition-colors hover:bg-pink-700 disabled:opacity-50" :disabled="!setupPassword" @click="goToConfirmStep">{{ t('settings.security.lockScreen.btnContinue') }}</button>
        </template>
        <template v-else>
          <input ref="setupConfirmRef" v-model="setupPasswordConfirm" type="password" :placeholder="t('settings.security.lockScreen.placeholderConfirm')" class="w-full rounded-xl border px-4 py-3 text-sm placeholder-gray-400 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500 bg-gray-100 border-gray-200 text-gray-900 dark:bg-gray-900 dark:border-gray-700 dark:text-white dark:placeholder-gray-500" maxlength="128" autofocus />
          <p v-if="setupError" class="text-center text-xs text-red-500">{{ setupError }}</p>
          <div class="flex gap-2">
            <button class="flex-1 rounded-xl border py-3 text-sm font-medium transition-colors border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800" @click="goBackToEnter">{{ t('settings.security.lockScreen.btnBack') }}</button>
            <button class="flex-1 rounded-xl bg-pink-600 py-3 text-sm font-medium text-white transition-colors hover:bg-pink-700 disabled:opacity-50" :disabled="!setupPasswordConfirm || isUnlocking" @click="handleSetPassword">{{ isUnlocking ? t('settings.security.lockScreen.settingUp') : t('settings.security.lockScreen.btnConfirm') }}</button>
          </div>
        </template>
      </div>

      <div v-else class="space-y-3">
        <div class="relative">
          <input ref="passwordInputRef" v-model="password" :type="showPassword ? 'text' : 'password'" :placeholder="t('settings.security.lockScreen.placeholderPassword')" tabindex="0" class="w-full rounded-xl border py-3 pl-4 pr-12 text-sm placeholder-gray-400 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500 disabled:opacity-40 bg-gray-100 border-gray-200 text-gray-900 dark:bg-gray-900 dark:border-gray-700 dark:text-white dark:placeholder-gray-500" :disabled="isLockedOut || isUnlocking" maxlength="128" autofocus />
          <button type="button" class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300" :disabled="isLockedOut || isUnlocking" @click="showPassword = !showPassword">
            <svg v-if="!showPassword" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
            <svg v-else class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M15 12a3 3 0 01-4.16 2.85M19.5 12c-.992 1.914-2.43 3.47-4.17 4.52L9.83 8" /></svg>
          </button>
        </div>
        <p v-if="errorMessage" class="text-center text-xs" :class="isLockedOut ? 'text-amber-500' : 'text-red-500'">{{ errorMessage }}</p>
        <p v-else-if="!isLockedOut && remainingRetries < 5 && remainingRetries > 0" class="text-center text-xs text-gray-400 dark:text-gray-500">{{ t('settings.security.lockScreen.retriesLeft', { n: remainingRetries }) }}</p>
        <button class="flex w-full items-center justify-center gap-2 rounded-xl bg-pink-600 py-3 text-sm font-medium text-white transition-colors hover:bg-pink-700 disabled:opacity-50" :disabled="!password || isUnlocking || isLockedOut" @click="handleUnlock">
          <template v-if="isUnlocking">
            <svg class="h-4 w-4 animate-spin text-white" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
            {{ t('settings.security.lockScreen.verifying') }}
          </template>
          <template v-else>
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
            {{ t('settings.security.lockScreen.btnUnlock') }}
          </template>
        </button>
        <p v-if="isLockedOut" class="text-center text-sm text-amber-500">{{ cooldownRemaining }} {{ t('settings.security.lockScreen.cooldownPrefix') }}</p>
        <button v-if="canUseWindowsHello" class="flex w-full items-center justify-center gap-2 rounded-xl border py-3 text-sm font-medium transition-colors disabled:opacity-50 border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:border-gray-500 dark:hover:bg-gray-800" :disabled="isUnlocking || isLockedOut" @click="handleWindowsHelloUnlock">
          <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="10" width="18" height="11" rx="2" /><path d="M7 10V7a5 5 0 0110 0v3" stroke-linecap="round" /><circle cx="12" cy="16" r="1.5" fill="currentColor" stroke="none" /><path d="M12 17.5v2" stroke-linecap="round" /></svg>
          {{ t('settings.security.lockScreen.btnHello') }}
        </button>
      </div>
    </div>
  </div>
</template>
