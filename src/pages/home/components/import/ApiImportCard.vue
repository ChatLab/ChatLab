<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useLayoutStore } from '@/stores/layout'

const { t } = useI18n()
const layoutStore = useLayoutStore()

// Pull 与 Push 共用“API 导入”入口，但继续进入各自独立的配置子页。
function openSyncSettings() {
  layoutStore.openSettings('api', 'sync')
}

function openApiSettings() {
  layoutStore.openSettings('api', 'api')
}
</script>

<template>
  <div class="flex w-full flex-col items-center space-y-6">
    <div class="grid w-full max-w-2xl gap-3 sm:h-[220px] sm:grid-cols-2">
      <section
        class="flex min-h-[210px] flex-col rounded-3xl bg-white/80 p-5 shadow-elevated ring-1 ring-gray-900/[0.04] backdrop-blur-md dark:bg-card-dark dark:ring-white/[0.06]"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 dark:bg-primary-500/10">
            <UIcon name="i-heroicons-cloud-arrow-down" class="h-5 w-5 text-primary-600 dark:text-primary-400" />
          </div>
          <span
            class="rounded-full bg-primary-50 px-2 py-1 text-[10px] font-bold uppercase text-primary-600 dark:bg-primary-500/10 dark:text-primary-400"
          >
            Pull
          </span>
        </div>
        <div class="mt-3">
          <h2 class="text-sm font-semibold text-gray-900 dark:text-white">{{ t('home.tabs.autoSyncTitle') }}</h2>
          <p class="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            {{ t('home.tabs.autoSyncDescription') }}
          </p>
        </div>
        <UButton class="mt-auto self-start" color="primary" variant="soft" size="sm" @click="openSyncSettings">
          {{ t('home.tabs.autoSyncButton') }}
        </UButton>
      </section>

      <section
        class="flex min-h-[210px] flex-col rounded-3xl bg-white/80 p-5 shadow-elevated ring-1 ring-gray-900/[0.04] backdrop-blur-md dark:bg-card-dark dark:ring-white/[0.06]"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 dark:bg-primary-500/10">
            <UIcon name="i-heroicons-paper-airplane" class="h-5 w-5 text-primary-600 dark:text-primary-400" />
          </div>
          <span
            class="rounded-full bg-primary-50 px-2 py-1 text-[10px] font-bold uppercase text-primary-600 dark:bg-primary-500/10 dark:text-primary-400"
          >
            Push
          </span>
        </div>
        <div class="mt-3">
          <h2 class="text-sm font-semibold text-gray-900 dark:text-white">{{ t('home.tabs.apiPushTitle') }}</h2>
          <p class="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            {{ t('home.tabs.apiPushDescription') }}
          </p>
        </div>
        <UButton class="mt-auto self-start" color="primary" variant="soft" size="sm" @click="openApiSettings">
          {{ t('home.tabs.apiPushButton') }}
        </UButton>
      </section>
    </div>
    <div class="h-6 w-full opacity-0 pointer-events-none" />
  </div>
</template>
