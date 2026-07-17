<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLayoutStore } from '@/stores/layout'

const { t } = useI18n()
const layoutStore = useLayoutStore()
const visible = ref(false)
const isUnlocking = ref(false)
const password = ref('')
const showPassword = ref(false)
const errorMessage = ref('')
const passwordInputRef = ref<HTMLInputElement | null>(null)
const canUnlock = computed(() => /^\d{4}$/.test(password.value))

let removeLockListener: (() => void) | null = null

onMounted(async () => {
  removeLockListener = window.securityApi.onLockStateChanged((locked) => {
    if (locked) showOverlay()
    else hideOverlay()
  })
  try {
    if ((await window.securityApi.getState()) === 'locked') showOverlay()
  } catch {
    // 主进程会在下一次状态变化时重新通知锁屏。
  }
})

onUnmounted(() => removeLockListener?.())

async function showOverlay(): Promise<void> {
  visible.value = true
  resetForm()
  layoutStore.closeOverlaysForAppLock()
  await nextTick()
  passwordInputRef.value?.focus()
}

function hideOverlay(): void {
  visible.value = false
  resetForm()
}

function resetForm(): void {
  password.value = ''
  showPassword.value = false
  errorMessage.value = ''
}

async function handleUnlock(): Promise<void> {
  if (!canUnlock.value || isUnlocking.value) return
  isUnlocking.value = true
  errorMessage.value = ''
  try {
    const result = await window.securityApi.unlock(password.value)
    if (result.success) return
    errorMessage.value = result.wrongPassword
      ? t('settings.security.lockScreen.errorWrongPassword')
      : t('settings.security.lockScreen.errorService')
    password.value = ''
  } catch {
    errorMessage.value = t('settings.security.lockScreen.errorService')
  } finally {
    isUnlocking.value = false
  }
}

function handlePasswordInput(event: Event): void {
  password.value = (event.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 4)
}
</script>

<template>
  <div
    v-if="visible"
    class="fixed inset-0 z-[99999] flex items-center justify-center bg-white dark:bg-page-dark"
    @keydown.enter="handleUnlock"
  >
    <div class="w-full max-w-sm px-8">
      <div class="mb-8 text-center">
        <div
          class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary-600 text-white shadow-sm dark:bg-primary-500"
        >
          <UIcon name="i-heroicons-lock-closed" class="h-6 w-6" />
        </div>
        <h1 class="text-xl font-semibold text-gray-900 dark:text-white">
          {{ t('settings.security.lockScreen.titleLocked') }}
        </h1>
      </div>

      <div class="space-y-3">
        <div class="relative">
          <input
            ref="passwordInputRef"
            :value="password"
            :type="showPassword ? 'text' : 'password'"
            inputmode="numeric"
            pattern="[0-9]*"
            autocomplete="current-password"
            :placeholder="t('settings.security.lockScreen.placeholderPassword')"
            class="w-full rounded-xl border border-gray-200 bg-gray-100 py-3 pl-4 pr-12 text-sm text-gray-900 placeholder-gray-400 outline-none transition focus:border-primary-500 focus:ring-1 focus:ring-primary-500 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500"
            :disabled="isUnlocking"
            maxlength="4"
            @input="handlePasswordInput"
          />
          <button
            type="button"
            class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300"
            :aria-label="t('settings.security.lockScreen.placeholderPassword')"
            :disabled="isUnlocking"
            @click="showPassword = !showPassword"
          >
            <UIcon :name="showPassword ? 'i-heroicons-eye-slash' : 'i-heroicons-eye'" class="h-5 w-5" />
          </button>
        </div>
        <p v-if="errorMessage" class="text-center text-xs text-red-500">
          {{ errorMessage }}
        </p>
        <UButton
          block
          size="lg"
          icon="i-heroicons-lock-open"
          :loading="isUnlocking"
          :disabled="!canUnlock"
          class="justify-center rounded-xl"
          @click="handleUnlock"
        >
          {{ isUnlocking ? t('settings.security.lockScreen.verifying') : t('settings.security.lockScreen.btnUnlock') }}
        </UButton>
      </div>
    </div>
  </div>
</template>
