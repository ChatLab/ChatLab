<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const emit = defineEmits<{
  (e: 'openIncrementalImport'): void
  (e: 'openSessionIndex'): void
  (e: 'openMessageExport'): void
}>()
</script>

<template>
  <div class="flex flex-col gap-2">
    <span class="mb-1 px-1 text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">
      {{ t('analysis.overview.tools') }}
    </span>
    <button
      class="group flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm font-medium text-gray-700 shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-all hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900 dark:border-white/5 dark:bg-white/5 dark:text-gray-300 dark:hover:border-white/10 dark:hover:bg-white/10 dark:hover:text-white"
      @click="emit('openIncrementalImport')"
    >
      <div class="flex items-center gap-2.5">
        <UIcon
          name="i-heroicons-plus-circle"
          class="h-4 w-4 text-gray-400 transition-colors group-hover:text-pink-500 dark:text-gray-500"
        />
        {{ t('analysis.tooltip.incrementalImport') }}
      </div>
      <UIcon
        name="i-heroicons-arrow-right-circle"
        class="h-4 w-4 text-gray-300 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100 dark:text-gray-600"
      />
    </button>

    <button
      class="group flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm font-medium text-gray-700 shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-all hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900 dark:border-white/5 dark:bg-white/5 dark:text-gray-300 dark:hover:border-white/10 dark:hover:bg-white/10 dark:hover:text-white"
      @click="emit('openSessionIndex')"
    >
      <div class="flex items-center gap-2.5">
        <UIcon
          name="i-heroicons-clock"
          class="h-4 w-4 text-gray-400 transition-colors group-hover:text-blue-500 dark:text-gray-500"
        />
        {{ t('analysis.tooltip.sessionIndex') }}
      </div>
      <UIcon
        name="i-heroicons-arrow-right-circle"
        class="h-4 w-4 text-gray-300 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100 dark:text-gray-600"
      />
    </button>

    <button
      class="group flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm font-medium text-gray-700 shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-all hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900 dark:border-white/5 dark:bg-white/5 dark:text-gray-300 dark:hover:border-white/10 dark:hover:bg-white/10 dark:hover:text-white"
      @click="emit('openMessageExport')"
    >
      <div class="flex items-center gap-2.5">
        <UIcon
          name="i-heroicons-document-arrow-down"
          class="h-4 w-4 text-gray-400 transition-colors group-hover:text-green-500 dark:text-gray-500"
        />
        {{ t('analysis.messageExport.title') }}
      </div>
      <UIcon
        name="i-heroicons-arrow-right-circle"
        class="h-4 w-4 text-gray-300 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100 dark:text-gray-600"
      />
    </button>
  </div>
</template>
