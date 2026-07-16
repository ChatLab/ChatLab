<script setup lang="ts">
/**
 * 安全设置面板 — 应用锁配置（三区块分阶段布局）
 * 全部文案使用 i18n 多语言适配
 */

import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { IS_ELECTRON } from '@/utils/platform'

const { t, locale } = useI18n()

interface LockConfig {
  enabled: boolean
  unlockMode: 'password' | 'windows-hello'
  idleTimeoutMinutes: number
  lockOnBlur: boolean
  lockOnStartup: boolean
  hasPassword: boolean
  windowsHelloAvailable: boolean
}

const config = ref<LockConfig | null>(null)
const isLoading = ref(true)
const isSaving = ref(false)
const saveMessage = ref('')
const saveError = ref(false)

const showPasswordForm = ref(false)
const oldPassword = ref('')
const newPassword = ref('')
const newPasswordConfirm = ref('')
const passwordError = ref('')
const isSubmitting = ref(false)

const helloPassword = ref('')
const helloError = ref('')
const helloTipText = ref('')
const isEnablingHello = ref(false)

const isEnabled = computed(() => config.value?.enabled ?? false)
const hasPassword = computed(() => config.value?.hasPassword ?? false)
const helloAvailable = computed(() => config.value?.windowsHelloAvailable ?? false)
const helloEnabled = computed(() => config.value?.unlockMode === 'windows-hello')

const canSubmitPassword = computed(() => {
  if (newPassword.value.length < 4) return false
  if (newPassword.value !== newPasswordConfirm.value) return false
  if (isEnabled.value && !oldPassword.value) return false
  return true
})

const timeoutOptions = computed(() => {
  const isEn = locale.value === 'en-US'
  const isJa = locale.value === 'ja-JP'
  const suffix = isEn ? ' min' : isJa ? '分' : ' 分钟'
  return [
    { label: `1${suffix}`, value: 1 },
    { label: `3${suffix}`, value: 3 },
    { label: `5${suffix}`, value: 5 },
    { label: `10${suffix}`, value: 10 },
    { label: `15${suffix}`, value: 15 },
    { label: `30${suffix}`, value: 30 },
    { label: `60${suffix}`, value: 60 },
  ]
})

onMounted(async () => {
  if (!IS_ELECTRON) { isLoading.value = false; return }
  await loadConfig()
  isLoading.value = false
})

async function loadConfig() {
  try { const cfg = await window.securityApi?.getConfig(); if (cfg) config.value = cfg } catch { /* ignore */ }
  try { const hello = await window.securityApi?.checkWindowsHello(); if (hello) helloTipText.value = hello.tipText } catch { /* ignore */ }
}

async function applyConfig(updates: Partial<{ enabled: boolean; unlockMode: 'password' | 'windows-hello'; idleTimeoutMinutes: number; lockOnBlur: boolean; lockOnStartup: boolean }>) {
  isSaving.value = true; saveMessage.value = ''; saveError.value = false
  try {
    const result = await window.securityApi?.updateConfig(updates)
    if (result?.success) { if (result.config) config.value = result.config; saveMessage.value = t('settings.security.toast.saved') }
    else { saveError.value = true; saveMessage.value = result?.error || t('settings.security.toast.failed') }
  } catch { saveError.value = true; saveMessage.value = t('settings.security.toast.failed') }
  finally { isSaving.value = false; setTimeout(() => { saveMessage.value = ''; saveError.value = false }, 3000) }
}

function openPasswordForm() { oldPassword.value = ''; newPassword.value = ''; newPasswordConfirm.value = ''; passwordError.value = ''; showPasswordForm.value = true }
function closePasswordForm() { showPasswordForm.value = false; oldPassword.value = ''; newPassword.value = ''; newPasswordConfirm.value = ''; passwordError.value = '' }

async function handleSetOrChangePassword() {
  passwordError.value = ''
  if (newPassword.value.length < 4) { passwordError.value = t('settings.security.password.errorTooShort'); return }
  if (newPassword.value.length > 128) { passwordError.value = t('settings.security.password.errorTooLong'); return }
  if (newPassword.value !== newPasswordConfirm.value) { passwordError.value = t('settings.security.password.errorMismatch'); return }
  if (isEnabled.value && newPassword.value === oldPassword.value) { passwordError.value = t('settings.security.password.errorSameAsOld'); return }

  isSubmitting.value = true
  try {
    let result
    if (isEnabled.value) {
      // 锁已开启 → 修改密码
      if (!oldPassword.value) { passwordError.value = t('settings.security.password.errorNeedOld'); isSubmitting.value = false; return }
      result = await window.securityApi?.changePassword(oldPassword.value, newPassword.value)
    } else if (hasPassword.value) {
      // 有密码但锁关闭 → 重新启用（可能同时改密码）
      if (!oldPassword.value) { passwordError.value = t('settings.security.password.errorNeedOld'); isSubmitting.value = false; return }
      if (newPassword.value) {
        result = await window.securityApi?.changePassword(oldPassword.value, newPassword.value)
      } else {
        result = await window.securityApi?.reEnableLock(oldPassword.value)
      }
    } else {
      // 首次设置密码
      result = await window.securityApi?.setPassword(newPassword.value)
    }
    if (result?.success) {
      closePasswordForm()
      if (!isEnabled.value) { await applyConfig({ enabled: true }) }
      await loadConfig()
      saveMessage.value = t('settings.security.password.success'); saveError.value = false
      setTimeout(() => (saveMessage.value = ''), 3000)
    } else { passwordError.value = result?.error || t('settings.security.password.errorGeneric') }
  } catch { passwordError.value = t('settings.security.password.errorRetry') }
  finally { isSubmitting.value = false }
}

async function handleDisableLock() {
  if (!confirm(t('settings.security.lock.disableConfirm'))) return
  await applyConfig({ enabled: false, unlockMode: 'password' })
  await loadConfig()
}

async function handleEnableHello() {
  helloError.value = ''; saveMessage.value = ''
  if (!helloPassword.value) { helloError.value = t('settings.security.hello.errorPassword'); return }

  isEnablingHello.value = true
  try {
    const helloStatus = await window.securityApi?.checkWindowsHello()
    if (!helloStatus?.available) { helloError.value = helloTipText.value || t('settings.security.hello.notAvailable'); return }
    const pwdOk = await window.securityApi?.verifyAppPassword(helloPassword.value)
    if (!pwdOk?.success) { helloError.value = t('settings.security.hello.errorAppPassword'); return }
    helloPassword.value = ''
    const verifyResult = await window.securityApi?.verifyHello(t('settings.security.hello.verifyMessage', { defaultValue: '请验证您的身份以开启 Windows Hello' }))
    if (!verifyResult) { helloError.value = t('settings.security.hello.errorService'); return }
    if (verifyResult.verified !== true) {
      if (verifyResult.cancelled) { helloError.value = t('settings.security.hello.errorCancelled') }
      else if (verifyResult.notAvailable) { helloError.value = helloTipText.value || t('settings.security.hello.errorNotAvailable') }
      else { helloError.value = verifyResult.error || t('settings.security.hello.errorVerifyFailed') }
      return
    }
    const result = await window.securityApi?.updateConfig({ unlockMode: 'windows-hello' })
    if (result?.success) {
      helloError.value = ''; await loadConfig()
      saveMessage.value = t('settings.security.hello.success'); saveError.value = false
      setTimeout(() => (saveMessage.value = ''), 3000)
    } else { helloError.value = result?.error || t('settings.security.hello.errorConfig') }
  } catch { helloError.value = t('settings.security.hello.errorService') }
  finally { isEnablingHello.value = false }
}

async function handleDisableHello() {
  await applyConfig({ unlockMode: 'password' }); await loadConfig()
  saveMessage.value = t('settings.security.hello.disabled'); saveError.value = false
  setTimeout(() => (saveMessage.value = ''), 3000)
}

async function handleTimeoutChange(minutes: number) { await applyConfig({ idleTimeoutMinutes: minutes }) }
async function handleLockOnBlurChange() { if (!config.value) return; await applyConfig({ lockOnBlur: !config.value.lockOnBlur }) }
async function handleLockOnStartupChange() { if (!config.value) return; await applyConfig({ lockOnStartup: !config.value.lockOnStartup }) }
async function handleManualLock() { try { await window.securityApi?.lock() } catch { /* ignore */ } }
</script>

<template>
  <div class="space-y-6">
    <!-- 加载中 -->
    <div v-if="isLoading" class="flex items-center justify-center py-12">
      <div class="h-6 w-6 animate-spin rounded-full border-2 border-pink-500 border-t-transparent" />
      <span class="ml-3 text-sm text-gray-500">{{ t('settings.security.loading') }}</span>
    </div>

    <!-- 非 Electron -->
    <div v-else-if="!IS_ELECTRON" class="rounded-xl border border-gray-200 bg-white p-6 text-center dark:border-gray-700 dark:bg-gray-800">
      <svg class="mx-auto mb-3 h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
      <p class="text-sm font-medium text-gray-700 dark:text-gray-300">{{ t('settings.security.electronOnly.title') }}</p>
      <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ t('settings.security.electronOnly.desc') }}</p>
    </div>

    <template v-else-if="config">
      <!-- ═══════════ 1. 应用锁状态区 ═══════════ -->
      <section class="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <h3 class="mb-1 text-base font-semibold text-gray-900 dark:text-white">{{ t('settings.security.lock.title') }}</h3>
        <p class="mb-4 text-sm text-gray-500 dark:text-gray-400">{{ t('settings.security.lock.desc') }}</p>
        <div v-if="!isEnabled" class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-gray-700 dark:text-gray-300">{{ t('settings.security.lock.statusOff') }}</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">{{ t('settings.security.lock.statusOffDesc') }}</p>
          </div>
        </div>
        <div v-else>
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-green-600 dark:text-green-400">{{ t('settings.security.lock.statusOn') }}</p>
              <p class="text-xs text-gray-500 dark:text-gray-400">{{ t('settings.security.lock.statusOnDesc') }}</p>
            </div>
            <button class="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-600 transition-colors hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20" @click="handleDisableLock">
              {{ t('settings.security.lock.disableBtn') }}
            </button>
          </div>
          <div class="mt-4 border-t border-gray-100 pt-4 dark:border-gray-700">
            <button class="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700" @click="handleManualLock">
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              {{ t('settings.security.lock.manualLock') }}
            </button>
          </div>
        </div>
      </section>

      <!-- ═══════════ 2. 密码区 ═══════════ -->
      <section class="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <h3 class="mb-1 text-base font-semibold text-gray-900 dark:text-white">
          {{ isEnabled ? t('settings.security.password.titleChange') : t('settings.security.password.titleSetup') }}
        </h3>
        <p class="mb-4 text-sm text-gray-500 dark:text-gray-400">
          {{ isEnabled ? t('settings.security.password.descChange') : t('settings.security.password.descSetup') }}
        </p>
        <div v-if="!showPasswordForm" class="flex flex-wrap items-center gap-3">
          <button class="rounded-lg bg-pink-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-pink-700" @click="openPasswordForm">
            {{ isEnabled ? t('settings.security.password.btnChange') : t('settings.security.password.btnSetup') }}
          </button>
        </div>
        <div v-else class="space-y-3 border-t border-gray-100 pt-4 dark:border-gray-700">
          <div v-if="isEnabled || hasPassword">
            <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">{{ t('settings.security.password.labelOld') }}</label>
            <input v-model="oldPassword" type="password" :placeholder="t('settings.security.password.placeholderOld')" class="w-full rounded-lg border px-3 py-2.5 text-sm placeholder-gray-400 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500 bg-white border-gray-300 text-gray-900 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-500" maxlength="128" />
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">{{ t('settings.security.password.labelNew') }}</label>
            <input v-model="newPassword" type="password" :placeholder="t('settings.security.password.placeholderNew')" class="w-full rounded-lg border px-3 py-2.5 text-sm placeholder-gray-400 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500 bg-white border-gray-300 text-gray-900 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-500" maxlength="128" />
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">{{ t('settings.security.password.labelConfirm') }}</label>
            <input v-model="newPasswordConfirm" type="password" :placeholder="t('settings.security.password.placeholderConfirm')" class="w-full rounded-lg border px-3 py-2.5 text-sm placeholder-gray-400 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500 bg-white border-gray-300 text-gray-900 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-500" maxlength="128" />
          </div>
          <p v-if="passwordError" class="text-xs text-red-500">{{ passwordError }}</p>
          <div class="flex gap-2">
            <button class="flex-1 rounded-lg border py-2 text-sm font-medium transition-colors border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700" @click="closePasswordForm">{{ t('settings.security.password.cancel') }}</button>
            <button class="flex-1 rounded-lg py-2 text-sm font-medium text-white transition-colors disabled:opacity-50" :class="canSubmitPassword ? 'bg-pink-600 hover:bg-pink-700' : 'bg-pink-400 cursor-not-allowed'" :disabled="!canSubmitPassword || isSubmitting" @click="handleSetOrChangePassword">
              <span v-if="isSubmitting" class="flex items-center justify-center gap-1">
                <svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                {{ t('settings.security.password.submitting') }}
              </span>
              <span v-else>{{ isEnabled ? t('settings.security.password.btnSave') : t('settings.security.password.btnEnable') }}</span>
            </button>
          </div>
        </div>
      </section>

      <!-- ═══════════ 3. Windows Hello 区 ═══════════ -->
      <section v-if="IS_ELECTRON" class="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <h3 class="mb-1 text-base font-semibold text-gray-900 dark:text-white">{{ t('settings.security.hello.title') }}</h3>
        <p class="mb-4 text-sm text-gray-500 dark:text-gray-400">{{ t('settings.security.hello.desc') }}</p>
        <div v-if="!helloAvailable">
          <button class="cursor-not-allowed rounded-lg bg-gray-300 px-4 py-2 text-sm text-gray-500 dark:bg-gray-700 dark:text-gray-500" disabled>{{ t('settings.security.hello.btnEnable') }}</button>
          <p class="mt-2 text-xs text-red-500">{{ helloTipText || t('settings.security.hello.notAvailable') }}</p>
        </div>
        <div v-else-if="helloEnabled">
          <p class="mb-3 text-sm text-green-600 dark:text-green-400">{{ t('settings.security.hello.enabled') }}</p>
          <button class="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700" @click="handleDisableHello">{{ t('settings.security.hello.btnDisable') }}</button>
        </div>
        <div v-else>
          <template v-if="!isEnabled">
            <button class="cursor-not-allowed rounded-lg bg-gray-300 px-4 py-2 text-sm text-gray-500 dark:bg-gray-700 dark:text-gray-500" disabled>{{ t('settings.security.hello.btnEnable') }}</button>
            <p class="mt-2 text-xs text-red-500">{{ t('settings.security.hello.disabledLock') }}</p>
          </template>
          <template v-else>
            <div class="max-w-sm space-y-3">
              <input v-model="helloPassword" type="password" :placeholder="t('settings.security.hello.placeholderPassword')" class="w-full rounded-lg border px-3 py-2.5 text-sm placeholder-gray-400 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500 bg-white border-gray-300 text-gray-900 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-500" maxlength="128" />
              <p v-if="helloError" class="text-xs text-red-500">{{ helloError }}</p>
              <button class="flex items-center gap-2 rounded-lg bg-pink-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-pink-700 disabled:opacity-50" :disabled="!helloPassword || isEnablingHello" @click="handleEnableHello">
                <span v-if="isEnablingHello" class="flex items-center gap-1">
                  <svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                  {{ t('settings.security.hello.verifying') }}
                </span>
                <span v-else>{{ t('settings.security.hello.btnEnable') }}</span>
              </button>
            </div>
          </template>
        </div>
      </section>

      <!-- ═══════════ 自动锁定设置 ═══════════ -->
      <section v-if="isEnabled" class="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <h3 class="mb-4 text-base font-semibold text-gray-900 dark:text-white">{{ t('settings.security.autoLock.title') }}</h3>
        <div class="space-y-4">
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{{ t('settings.security.autoLock.idleLabel') }}</label>
            <p class="mb-2 text-xs text-gray-500 dark:text-gray-400">{{ t('settings.security.autoLock.idleDesc') }}</p>
            <select :value="config.idleTimeoutMinutes" class="w-40 rounded-lg border bg-white px-3 py-2 text-sm text-gray-700 focus:border-pink-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300" @change="handleTimeoutChange(Number(($event.target as HTMLSelectElement).value))">
              <option v-for="opt in timeoutOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>
          </div>
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-gray-700 dark:text-gray-300">{{ t('settings.security.autoLock.blurLabel') }}</p>
              <p class="text-xs text-gray-500 dark:text-gray-400">{{ t('settings.security.autoLock.blurDesc') }}</p>
            </div>
            <button type="button" :class="['relative inline-flex h-6 w-11 items-center rounded-full transition-colors', config.lockOnBlur ? 'bg-pink-600' : 'bg-gray-300 dark:bg-gray-600']" role="switch" :aria-checked="config.lockOnBlur" @click="handleLockOnBlurChange">
              <span :class="['inline-block h-4 w-4 transform rounded-full bg-white transition-transform', config.lockOnBlur ? 'translate-x-6' : 'translate-x-1']" />
            </button>
          </div>
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-gray-700 dark:text-gray-300">{{ t('settings.security.autoLock.startupLabel') }}</p>
              <p class="text-xs text-gray-500 dark:text-gray-400">{{ t('settings.security.autoLock.startupDesc') }}</p>
            </div>
            <button type="button" :class="['relative inline-flex h-6 w-11 items-center rounded-full transition-colors', config.lockOnStartup ? 'bg-pink-600' : 'bg-gray-300 dark:bg-gray-600']" role="switch" :aria-checked="config.lockOnStartup" @click="handleLockOnStartupChange">
              <span :class="['inline-block h-4 w-4 transform rounded-full bg-white transition-transform', config.lockOnStartup ? 'translate-x-6' : 'translate-x-1']" />
            </button>
          </div>
        </div>
      </section>

      <transition name="fade">
        <p v-if="saveMessage" class="text-sm" :class="saveError ? 'text-red-500' : 'text-green-500'">{{ saveMessage }}</p>
      </transition>
    </template>
  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
