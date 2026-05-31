<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useToast } from '@/composables/useToast'
import { useSettingsStore } from '@/stores/settings'
import { useLayoutStore } from '@/stores/layout'
import { useAuthStore } from '@/stores/auth'
import { usePlatformService } from '@/services'
import { IS_ELECTRON } from '@/utils/platform'

const { t } = useI18n()
const toast = useToast()
const router = useRouter()
const settingsStore = useSettingsStore()
const layoutStore = useLayoutStore()
const authStore = useAuthStore()
const { debugMode } = storeToRefs(settingsStore)

const showLogout = !IS_ELECTRON && authStore.isAuthenticated

function handleLogout() {
  layoutStore.closeSettings()
  authStore.logout()
  router.push({ name: 'login' })
}

const appVersion = ref(t('common.loading'))
const isCheckingUpdate = ref(false)
const analyticsEnabled = ref(true)

async function loadAppVersion() {
  try {
    appVersion.value = await usePlatformService().getVersion()
  } catch (error) {
    console.error('Failed to get version:', error)
    appVersion.value = t('settings.about.unknown')
  }
}

async function loadAnalyticsEnabled() {
  try {
    analyticsEnabled.value = await usePlatformService().getAnalyticsEnabled()
  } catch (error) {
    console.error('Failed to get analytics status:', error)
  }
}

async function toggleAnalytics(enabled: boolean) {
  try {
    await usePlatformService().setAnalyticsEnabled(enabled)
    analyticsEnabled.value = enabled
  } catch (error) {
    console.error('Failed to set analytics:', error)
  }
}

async function checkUpdate() {
  isCheckingUpdate.value = true
  try {
    const result = await usePlatformService().checkUpdate()
    if (!result) return

    if (result.error) {
      toast.fail(t('settings.about.updateCheckFailed', { error: result.error }))
    } else if (result.hasUpdate) {
      toast.success(t('settings.about.newVersionAvailable', { version: result.latestVersion }), {
        duration: 15_000,
        description: IS_ELECTRON ? undefined : t('settings.about.webUpdateHint'),
      })
    } else {
      toast.success(t('settings.about.upToDate'))
    }
  } catch (error) {
    console.error('Update check failed:', error)
  } finally {
    if (IS_ELECTRON) {
      setTimeout(() => {
        isCheckingUpdate.value = false
      }, 3000)
    } else {
      isCheckingUpdate.value = false
    }
  }
}

onMounted(() => {
  loadAppVersion()
  loadAnalyticsEnabled()
})
</script>

<template>
  <div class="space-y-6 pr-1">
    <!-- 关于 -->
    <div>
      <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <UIcon name="i-heroicons-information-circle" class="h-4 w-4 text-blue-500" />
        {{ t('settings.about.title') }}
      </h3>
      <div class="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div
              class="flex h-12 w-12 items-center justify-center rounded-xl bg-linear-to-br from-pink-500 to-pink-600"
            >
              <UIcon name="i-heroicons-chat-bubble-left-right" class="h-6 w-6 text-white" />
            </div>
            <div>
              <p class="text-sm font-semibold text-gray-900 dark:text-white">ChatLab</p>
              <p class="text-xs text-gray-500 dark:text-gray-400">{{ t('settings.about.description') }}</p>
              <p class="mt-1 text-xs text-gray-400">{{ t('settings.about.version') }} {{ appVersion }}</p>
            </div>
          </div>
          <UButton :disabled="isCheckingUpdate" color="primary" variant="soft" size="sm" @click="checkUpdate">
            <UIcon name="i-heroicons-arrow-path" class="mr-1 h-4 w-4" :class="{ 'animate-spin': isCheckingUpdate }" />
            {{ isCheckingUpdate ? t('settings.about.checking') : t('settings.about.checkUpdate') }}
          </UButton>
        </div>
      </div>
    </div>

    <!-- 隐私设置 -->
    <div>
      <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <UIcon name="i-heroicons-shield-check" class="h-4 w-4 text-purple-500" />
        {{ t('settings.about.privacy.title') }}
      </h3>
      <div class="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-gray-900 dark:text-white">{{ t('settings.about.privacy.analytics') }}</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {{ t('settings.about.privacy.analyticsDesc') }}
            </p>
          </div>
          <USwitch :model-value="analyticsEnabled" @update:model-value="toggleAnalytics" />
        </div>
      </div>
    </div>

    <!-- 开发者选项 -->
    <div>
      <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <UIcon name="i-heroicons-wrench-screwdriver" class="h-4 w-4 text-orange-500" />
        {{ t('settings.about.developer.title') }}
      </h3>
      <div class="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-gray-900 dark:text-white">
              {{ t('settings.about.developer.debugMode') }}
            </p>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {{ t('settings.about.developer.debugModeDesc') }}
            </p>
          </div>
          <USwitch :model-value="debugMode" @update:model-value="settingsStore.setDebugMode" />
        </div>
      </div>
    </div>

    <!-- 退出登录（仅 Server 模式已认证时显示） -->
    <div v-if="showLogout">
      <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <UIcon name="i-heroicons-arrow-right-on-rectangle" class="h-4 w-4 text-red-500" />
        {{ t('common.login.logoutTitle') }}
      </h3>
      <div class="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-gray-900 dark:text-white">{{ t('common.login.logoutDesc') }}</p>
          </div>
          <UButton color="error" variant="soft" size="sm" @click="handleLogout">
            <UIcon name="i-heroicons-arrow-right-on-rectangle" class="mr-1 h-4 w-4" />
            {{ t('common.login.logout') }}
          </UButton>
        </div>
      </div>
    </div>
  </div>
</template>
