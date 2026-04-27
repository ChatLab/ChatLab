<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLayoutStore } from '@/stores/layout'
import { useSettingsStore } from '@/stores/settings'
import { useColorMode } from '@vueuse/core'
import { availableLocales, type LocaleType } from '@/i18n'
import NetworkSettingsSection from './NetworkSettingsSection.vue'
import UITabs from '@/components/UI/Tabs.vue'

const { t } = useI18n()

// Store
const layoutStore = useLayoutStore()
const settingsStore = useSettingsStore()
const { screenshotMobileAdapt, toolsPanelPosition } = storeToRefs(layoutStore)
const { locale, defaultSessionTab } = storeToRefs(settingsStore)

// Auto Launch
const openAtLogin = ref(false)
const isPackaged = ref(true)

onMounted(async () => {
  try {
    const enabled = await window.api.app.getOpenAtLogin()
    openAtLogin.value = enabled
  } catch {
    isPackaged.value = false
  }
})

async function handleAutoLaunchChange(enabled: boolean) {
  const { success } = await window.api.app.setOpenAtLogin(enabled)
  if (!success) {
    openAtLogin.value = !enabled
    isPackaged.value = false
  }
}

// Color Mode
const colorMode = useColorMode({
  emitAuto: true,
  initialValue: 'light',
})

// Color mode options
const colorModeOptions = computed(() => [
  { label: t('settings.basic.appearance.auto'), value: 'auto' },
  { label: t('settings.basic.appearance.light'), value: 'light' },
  { label: t('settings.basic.appearance.dark'), value: 'dark' },
])

// Language options
const languageOptions = computed(() =>
  availableLocales.map((l) => ({
    label: l.nativeName,
    value: l.code,
  }))
)

// Handle language change with writable computed for v-model support
const currentLocale = computed({
  get: () => locale.value,
  set: (val: LocaleType) => settingsStore.setLocale(val),
})

// Default session tab options
const defaultTabOptions = computed(() => [
  { label: t('settings.basic.defaultTab.overview'), value: 'overview' },
  { label: t('settings.basic.defaultTab.aiChat'), value: 'ai-chat' },
])

// Tools panel position options
const toolsPanelPositionOptions = computed(() => [
  { label: t('settings.basic.toolsPanel.positionHeader'), value: 'header' },
  { label: t('settings.basic.toolsPanel.positionSide'), value: 'side' },
])

// Sync theme with main process
import { watch } from 'vue'
watch(
  colorMode,
  (val) => {
    const mode = val === 'auto' ? 'system' : (val as 'light' | 'dark')
    window.api.setThemeSource(mode)
  },
  { immediate: true }
)
</script>

<template>
  <div class="space-y-6 pb-6">
    <!-- 常规：语言 + 开机自启动 -->
    <div>
      <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <UIcon name="i-heroicons-cog-6-tooth" class="h-4 w-4 text-gray-500" />
        {{ t('settings.basic.general.title') }}
      </h3>
      <div class="rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
        <div class="flex items-center justify-between p-4">
          <div class="flex-1 pr-4">
            <p class="text-sm font-medium text-gray-900 dark:text-white">
              {{ t('settings.basic.language.description') }}
            </p>
          </div>
          <div class="w-72">
            <UITabs v-model="currentLocale" size="sm" class="gap-0" :items="languageOptions"></UITabs>
          </div>
        </div>
        <div class="border-t border-gray-200 dark:border-gray-700"></div>
        <div class="flex items-center justify-between p-4">
          <div class="flex-1 pr-4">
            <p class="text-sm font-medium text-gray-900 dark:text-white">
              {{ t('settings.basic.autoLaunch.openAtLogin') }}
            </p>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {{
                isPackaged ? t('settings.basic.autoLaunch.openAtLoginDesc') : t('settings.basic.autoLaunch.devModeHint')
              }}
            </p>
          </div>
          <USwitch v-model="openAtLogin" :disabled="!isPackaged" @update:model-value="handleAutoLaunchChange" />
        </div>
      </div>
    </div>

    <!-- 外观设置 -->
    <div>
      <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <UIcon name="i-heroicons-paint-brush" class="h-4 w-4 text-pink-500" />
        {{ t('settings.basic.appearance.title') }}
      </h3>
      <div class="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <div class="flex items-center justify-between">
          <div class="flex-1 pr-4">
            <p class="text-sm font-medium text-gray-900 dark:text-white">
              {{ t('settings.basic.appearance.themeMode') }}
            </p>
          </div>
          <div class="w-64">
            <UTabs v-model="colorMode" size="sm" class="gap-0" :items="colorModeOptions"></UTabs>
          </div>
        </div>
      </div>
    </div>

    <!-- 偏好设置：默认标签页 + 截图 -->
    <div>
      <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <UIcon name="i-heroicons-adjustments-horizontal" class="h-4 w-4 text-purple-500" />
        {{ t('settings.basic.preferences.title') }}
      </h3>
      <div class="rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
        <div class="flex items-center justify-between p-4">
          <div class="flex-1 pr-4">
            <p class="text-sm font-medium text-gray-900 dark:text-white">
              {{ t('settings.basic.defaultTab.description') }}
            </p>
          </div>
          <div class="w-64">
            <UTabs v-model="defaultSessionTab" size="sm" class="gap-0" :items="defaultTabOptions"></UTabs>
          </div>
        </div>
        <div class="border-t border-gray-200 dark:border-gray-700"></div>
        <div class="flex items-center justify-between p-4">
          <div class="flex-1 pr-4">
            <p class="text-sm font-medium text-gray-900 dark:text-white">
              {{ t('settings.basic.toolsPanel.positionLabel') }}
            </p>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {{ t('settings.basic.toolsPanel.positionDesc') }}
            </p>
          </div>
          <div class="w-64">
            <UTabs v-model="toolsPanelPosition" size="sm" class="gap-0" :items="toolsPanelPositionOptions"></UTabs>
          </div>
        </div>
        <div class="border-t border-gray-200 dark:border-gray-700"></div>
        <div class="flex items-center justify-between p-4">
          <div class="flex-1 pr-4">
            <p class="text-sm font-medium text-gray-900 dark:text-white">
              {{ t('settings.basic.screenshot.mobileAdapt') }}
            </p>
            <p class="text-xs text-gray-500 dark:text-gray-400">{{ t('settings.basic.screenshot.mobileAdaptDesc') }}</p>
          </div>
          <USwitch v-model="screenshotMobileAdapt" />
        </div>
      </div>
    </div>

    <!-- 网络设置 -->
    <NetworkSettingsSection />
  </div>
</template>
