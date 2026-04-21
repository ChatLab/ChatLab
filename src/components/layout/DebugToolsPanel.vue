<script setup lang="ts">
import { ref, computed } from 'vue'
import { useDark, useToggle } from '@vueuse/core'
import { useSettingsStore } from '@/stores/settings'
import { availableLocales, type LocaleType } from '@/i18n'

const settingsStore = useSettingsStore()

const isDark = useDark()
const toggleDark = useToggle(isDark)

const isHovered = ref(false)
let hideTimer: ReturnType<typeof setTimeout> | null = null

const isVisible = computed(() => isHovered.value)

function onMouseEnter() {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  isHovered.value = true
}

function onMouseLeave() {
  hideTimer = setTimeout(() => {
    isHovered.value = false
  }, 200)
}

const localeModel = computed({
  get: () => settingsStore.locale,
  set: (val: string) => settingsStore.setLocale(val as LocaleType),
})

const localeItems = availableLocales.map((l) => ({
  label: l.nativeName,
  value: l.code,
}))
</script>

<template>
  <div class="fixed right-0 top-[70%] z-40" @mouseenter="onMouseEnter" @mouseleave="onMouseLeave">
    <!-- Trigger -->
    <div
      class="h-10 w-6 cursor-pointer items-center justify-center rounded-l-lg border border-r-0 border-amber-300/50 bg-amber-50 text-amber-500 shadow-sm transition-opacity duration-200 hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-950 dark:text-amber-400 dark:hover:bg-amber-900"
      :class="isVisible ? 'pointer-events-none flex opacity-0' : 'flex opacity-100'"
    >
      <UIcon name="i-heroicons-bug-ant" class="h-3.5 w-3.5" />
    </div>

    <!-- Panel -->
    <div
      class="absolute right-0 top-0 transition-all duration-250 ease-in-out"
      :class="isVisible ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-full opacity-0'"
    >
      <div
        class="no-capture flex w-28 flex-col items-center rounded-l-xl border border-r-0 border-amber-200/60 bg-white p-3 shadow-lg dark:border-amber-500/10 dark:bg-gray-900"
      >
        <div class="mb-2">
          <span class="px-0.5 text-[9px] font-bold uppercase tracking-widest text-amber-500 dark:text-amber-400">
            Debug
          </span>
        </div>

        <div class="flex w-full flex-col items-center gap-3">
          <!-- 深色/浅色模式切换 -->
          <button
            class="group flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-gray-600 transition-all hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-white"
            @click="toggleDark()"
          >
            <UIcon
              :name="isDark ? 'i-heroicons-moon-solid' : 'i-heroicons-sun-solid'"
              class="h-3.5 w-3.5 transition-colors"
              :class="isDark ? 'text-indigo-400' : 'text-amber-400'"
            />
            <span class="whitespace-nowrap">{{ isDark ? 'Dark' : 'Light' }}</span>
          </button>

          <!-- 语言选择 -->
          <UTabs v-model="localeModel" :items="localeItems" :content="false" orientation="vertical" size="xs" />
        </div>
      </div>
    </div>
  </div>
</template>
