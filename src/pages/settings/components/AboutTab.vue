<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/settings'

const { t } = useI18n()
const settingsStore = useSettingsStore()
const { debugMode } = storeToRefs(settingsStore)

// 版本信息
const appVersion = ref(t('common.loading'))
const isCheckingUpdate = ref(false)

// 匿名统计开关
const analyticsEnabled = ref(true)

// 获取应用版本
async function loadAppVersion() {
  try {
    appVersion.value = await window.api.app.getVersion()
  } catch (error) {
    console.error('获取版本号失败:', error)
    appVersion.value = t('settings.about.unknown')
  }
}

// 加载统计开关状态
async function loadAnalyticsEnabled() {
  try {
    analyticsEnabled.value = await window.api.app.getAnalyticsEnabled()
  } catch (error) {
    console.error('获取统计开关状态失败:', error)
  }
}

// 切换统计开关
async function toggleAnalytics(enabled: boolean) {
  try {
    await window.api.app.setAnalyticsEnabled(enabled)
    analyticsEnabled.value = enabled
  } catch (error) {
    console.error('设置统计开关失败:', error)
  }
}

// 检查更新
function checkUpdate() {
  isCheckingUpdate.value = true
  window.api.app.checkUpdate()
  // 3 秒后恢复按钮状态（实际检查结果由主进程 dialog 显示）
  setTimeout(() => {
    isCheckingUpdate.value = false
  }, 3000)
}

// 组件挂载时加载数据
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
  </div>
</template>
