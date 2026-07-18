<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { syncNativeDialog } from './native-dialog'

const { t } = useI18n()
const emit = defineEmits<{
  ready: []
  'lock-state-change': [locked: boolean]
}>()
const isUnlocking = ref(false)
const password = ref('')
const showPassword = ref(false)
const errorMessage = ref('')
const retryAfterSeconds = ref(0)
const dialogRef = ref<HTMLDialogElement | null>(null)
const passwordInputRef = ref<HTMLInputElement | null>(null)
const canUnlock = computed(() => /^\d{4}$/.test(password.value) && retryAfterSeconds.value === 0)
const cooldownMessage = computed(() =>
  t('settings.security.lockScreen.errorTooManyAttempts', { seconds: retryAfterSeconds.value })
)

let removeLockListener: (() => void) | null = null
let cooldownTimer: ReturnType<typeof setInterval> | null = null
let latestLockEvent: boolean | null = null

onMounted(async () => {
  removeLockListener = window.securityApi.onLockStateChanged((locked) => {
    latestLockEvent = locked
    void applyLockState(locked)
  })
  try {
    const initialState = await window.securityApi.getState()
    // 查询期间若收到更新事件，以事件携带的最新状态为准，避免用旧结果覆盖锁屏。
    if (latestLockEvent === null) {
      await applyLockState(initialState === 'locked')
    }
  } catch {
    if (latestLockEvent === null) {
      await applyLockState(true)
      errorMessage.value = t('settings.security.lockScreen.errorService')
    }
  }
  await nextTick()
  emit('ready')
})

onUnmounted(() => {
  removeLockListener?.()
  clearCooldownTimer()
})

async function applyLockState(locked: boolean): Promise<void> {
  emit('lock-state-change', locked)
  if (locked) await showOverlay()
  else hideOverlay()
}

async function showOverlay(): Promise<void> {
  resetForm()
  // 原生 modal dialog 会把文档其余部分设为 inert，保留业务状态的同时阻止已有或异步弹窗抢焦点。
  syncNativeDialog(dialogRef.value, true)
  await nextTick()
  passwordInputRef.value?.focus()
}

function hideOverlay(): void {
  syncNativeDialog(dialogRef.value, false)
  resetForm()
}

function resetForm(): void {
  password.value = ''
  showPassword.value = false
  errorMessage.value = ''
  retryAfterSeconds.value = 0
  clearCooldownTimer()
}

async function handleUnlock(): Promise<void> {
  if (!canUnlock.value || isUnlocking.value) return
  isUnlocking.value = true
  errorMessage.value = ''
  try {
    const result = await window.securityApi.unlock(password.value)
    if (result.success) {
      await applyLockState(false)
      return
    }
    if (result.retryAfterSeconds && result.retryAfterSeconds > 0) {
      password.value = ''
      startCooldownTimer(result.retryAfterSeconds)
      return
    }
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

function startCooldownTimer(seconds: number): void {
  clearCooldownTimer()
  retryAfterSeconds.value = seconds
  cooldownTimer = setInterval(() => {
    retryAfterSeconds.value = Math.max(0, retryAfterSeconds.value - 1)
    if (retryAfterSeconds.value > 0) return

    clearCooldownTimer()
    nextTick(() => passwordInputRef.value?.focus())
  }, 1000)
}

function clearCooldownTimer(): void {
  if (!cooldownTimer) return
  clearInterval(cooldownTimer)
  cooldownTimer = null
}

function handlePasswordInput(event: Event): void {
  password.value = (event.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 4)
}
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialogRef"
      class="pointer-events-auto m-0 h-screen max-h-none w-screen max-w-none border-0 bg-white p-0 text-gray-900 outline-none backdrop:bg-white dark:bg-page-dark dark:text-white dark:backdrop:bg-page-dark"
      @cancel.prevent
      @keydown.enter="handleUnlock"
    >
      <div class="flex h-full w-full items-center justify-center">
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
                :disabled="isUnlocking || retryAfterSeconds > 0"
                maxlength="4"
                @input="handlePasswordInput"
              />
              <button
                type="button"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300"
                :aria-label="t('settings.security.lockScreen.placeholderPassword')"
                :disabled="isUnlocking || retryAfterSeconds > 0"
                @click="showPassword = !showPassword"
              >
                <UIcon :name="showPassword ? 'i-heroicons-eye-slash' : 'i-heroicons-eye'" class="h-5 w-5" />
              </button>
            </div>
            <p v-if="retryAfterSeconds > 0" class="text-center text-xs text-amber-500">
              {{ cooldownMessage }}
            </p>
            <p v-else-if="errorMessage" class="text-center text-xs text-red-500">
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
              {{
                isUnlocking ? t('settings.security.lockScreen.verifying') : t('settings.security.lockScreen.btnUnlock')
              }}
            </UButton>
          </div>
        </div>
      </div>
    </dialog>
  </Teleport>
</template>
