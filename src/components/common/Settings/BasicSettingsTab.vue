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
import { usePlatformService } from '@/services'
import { IS_ELECTRON } from '@/utils/platform'
import { INSIGHT_CARD_THEMES, type InsightCardThemeId } from '@/utils/insight-card-theme'
import type { DesktopCloseBehavior } from '@openchatlab/shared-types'

const { t } = useI18n()

withDefaults(
  defineProps<{
    showDefaultSessionTab?: boolean
    showToolsPanel?: boolean
  }>(),
  {
    showDefaultSessionTab: true,
    showToolsPanel: true,
  }
)

// Store
const layoutStore = useLayoutStore()
const settingsStore = useSettingsStore()
const { toolsPanelPosition } = storeToRefs(layoutStore)
const { locale, defaultSessionTab, insightCardTheme, debugMode } = storeToRefs(settingsStore)

// Auto Launch
const openAtLogin = ref(false)
const isPackaged = ref(true)
const isWindowsDesktop =
  IS_ELECTRON && typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('win')
const desktopCloseBehavior = ref<DesktopCloseBehavior>('background')
let savedDesktopCloseBehavior: DesktopCloseBehavior = 'background'

onMounted(async () => {
  if (!IS_ELECTRON) {
    isPackaged.value = false
    return
  }
  try {
    const enabled = await usePlatformService().getOpenAtLogin()
    openAtLogin.value = enabled
  } catch {
    isPackaged.value = false
  }

  if (isWindowsDesktop) {
    try {
      savedDesktopCloseBehavior = await usePlatformService().getDesktopCloseBehavior()
      desktopCloseBehavior.value = savedDesktopCloseBehavior
    } catch {
      desktopCloseBehavior.value = 'background'
    }
  }
})

async function handleAutoLaunchChange(enabled: boolean) {
  if (!IS_ELECTRON) return
  const { success } = await usePlatformService().setOpenAtLogin(enabled)
  if (!success) {
    openAtLogin.value = !enabled
    isPackaged.value = false
  }
}

async function handleDesktopCloseBehaviorChange(value: string | number) {
  if (value !== 'background' && value !== 'quit') return

  const nextBehavior: DesktopCloseBehavior = value
  desktopCloseBehavior.value = nextBehavior
  const result = await usePlatformService().setDesktopCloseBehavior(nextBehavior)
  if (result.success) {
    savedDesktopCloseBehavior = nextBehavior
  } else {
    desktopCloseBehavior.value = savedDesktopCloseBehavior
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

function getInsightCardThemePreview(startColor: string, endColor: string) {
  return {
    background: `linear-gradient(135deg, color-mix(in srgb, ${startColor} 35%, white), color-mix(in srgb, ${endColor} 42%, white))`,
  }
}

function selectInsightCardTheme(theme: InsightCardThemeId) {
  insightCardTheme.value = theme
}

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
  { label: t('settings.basic.defaultTab.insights'), value: 'insights' },
  { label: t('settings.basic.defaultTab.aiChat'), value: 'ai-chat' },
])

// Tools panel position options
const toolsPanelPositionOptions = computed(() => [
  { label: t('settings.basic.toolsPanel.positionHeader'), value: 'header' },
  { label: t('settings.basic.toolsPanel.positionSide'), value: 'side' },
])

const desktopCloseBehaviorOptions = computed(() => [
  { label: t('settings.basic.closeBehavior.background'), value: 'background' },
  { label: t('settings.basic.closeBehavior.quit'), value: 'quit' },
])
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
        <template v-if="IS_ELECTRON">
          <div class="border-t border-gray-200 dark:border-gray-700"></div>
          <div class="flex items-center justify-between p-4">
            <div class="flex-1 pr-4">
              <p class="text-sm font-medium text-gray-900 dark:text-white">
                {{ t('settings.basic.autoLaunch.openAtLogin') }}
              </p>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                {{
                  isPackaged
                    ? t('settings.basic.autoLaunch.openAtLoginDesc')
                    : t('settings.basic.autoLaunch.devModeHint')
                }}
              </p>
            </div>
            <USwitch v-model="openAtLogin" :disabled="!isPackaged" @update:model-value="handleAutoLaunchChange" />
          </div>
          <template v-if="isWindowsDesktop">
            <div class="border-t border-gray-200 dark:border-gray-700"></div>
            <div class="flex items-center justify-between p-4">
              <div class="flex-1 pr-4">
                <p class="text-sm font-medium text-gray-900 dark:text-white">
                  {{ t('settings.basic.closeBehavior.label') }}
                </p>
              </div>
              <div class="w-64">
                <UTabs
                  :model-value="desktopCloseBehavior"
                  size="sm"
                  class="gap-0"
                  :items="desktopCloseBehaviorOptions"
                  @update:model-value="handleDesktopCloseBehaviorChange"
                ></UTabs>
              </div>
            </div>
          </template>
        </template>
      </div>
    </div>

    <!-- 外观设置 -->
    <div>
      <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <UIcon name="i-heroicons-paint-brush" class="h-4 w-4 text-pink-500" />
        {{ t('settings.basic.appearance.title') }}
      </h3>
      <div class="rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
        <div class="flex items-center justify-between p-4">
          <div class="flex-1 pr-4">
            <p class="text-sm font-medium text-gray-900 dark:text-white">
              {{ t('settings.basic.appearance.themeMode') }}
            </p>
          </div>
          <div class="w-64">
            <UTabs v-model="colorMode" size="sm" class="gap-0" :items="colorModeOptions"></UTabs>
          </div>
        </div>
        <div class="border-t border-gray-200 dark:border-gray-700"></div>
        <div class="flex items-center justify-between p-4">
          <div class="flex-1 pr-4">
            <p class="text-sm font-medium text-gray-900 dark:text-white">
              {{ t('settings.basic.appearance.insightCardTheme') }}
            </p>
          </div>
          <div class="flex shrink-0 items-center gap-1.5">
            <button
              v-for="(theme, index) in INSIGHT_CARD_THEMES"
              :key="theme.id"
              type="button"
              class="group flex h-9 w-9 items-center justify-center rounded-full outline-none transition-colors hover:bg-gray-200/60 focus-visible:ring-2 focus-visible:ring-primary-500/40 dark:hover:bg-gray-700/70"
              :aria-label="t('settings.basic.appearance.insightCardThemeOption', { index: index + 1 })"
              :aria-pressed="insightCardTheme === theme.id"
              @click="selectInsightCardTheme(theme.id)"
            >
              <span
                class="relative block h-6 w-6 overflow-hidden rounded-full shadow-sm ring-1 transition-all"
                :class="
                  insightCardTheme === theme.id
                    ? 'ring-2 ring-primary-500 ring-offset-2 ring-offset-gray-50 dark:ring-primary-400 dark:ring-offset-gray-800'
                    : 'ring-black/5 group-hover:ring-black/10 dark:ring-white/10 dark:group-hover:ring-white/20'
                "
                :style="getInsightCardThemePreview(theme.startColor, theme.endColor)"
              >
                <span
                  v-if="insightCardTheme === theme.id"
                  class="absolute inset-0 flex items-center justify-center text-gray-800/70"
                >
                  <UIcon name="i-heroicons-check-20-solid" class="h-3.5 w-3.5" />
                </span>
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 偏好设置 -->
    <div v-if="showDefaultSessionTab || (showToolsPanel && debugMode)">
      <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <UIcon name="i-heroicons-adjustments-horizontal" class="h-4 w-4 text-purple-500" />
        {{ t('settings.basic.preferences.title') }}
      </h3>
      <div class="rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
        <div v-if="showDefaultSessionTab" class="flex items-center justify-between p-4">
          <div class="flex-1 pr-4">
            <p class="text-sm font-medium text-gray-900 dark:text-white">
              {{ t('settings.basic.defaultTab.description') }}
            </p>
          </div>
          <div class="w-64">
            <UTabs v-model="defaultSessionTab" size="sm" class="gap-0" :items="defaultTabOptions"></UTabs>
          </div>
        </div>
        <div
          v-if="showDefaultSessionTab && showToolsPanel && debugMode"
          class="border-t border-gray-200 dark:border-gray-700"
        ></div>
        <div v-if="showToolsPanel && debugMode" class="flex items-center justify-between p-4">
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
      </div>
    </div>

    <!-- 网络设置（仅 Electron 桌面版） -->
    <NetworkSettingsSection v-if="IS_ELECTRON" />
  </div>
</template>
