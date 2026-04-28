<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SerializedErrorInfo } from '@electron/shared/types'
import ErrorDetailModal from './ErrorDetailModal.vue'

const { t } = useI18n()

defineProps<{
  error: SerializedErrorInfo
}>()

const showDetail = ref(false)

function getDisplayMessage(error: SerializedErrorInfo): string {
  return error.friendlyMessage || error.message || t('ai.chat.error.unknown')
}
</script>

<template>
  <div
    class="group relative my-2 w-full min-w-[320px] cursor-pointer rounded-lg border border-red-200 bg-red-50/60 px-3.5 py-3 text-[13px] transition-all duration-200 hover:border-red-300 hover:bg-red-50 dark:border-red-900/30 dark:bg-red-950/20 dark:hover:border-red-800/50 dark:hover:bg-red-950/30"
    @click="showDetail = true"
  >
    <!-- Header -->
    <div class="mb-1.5 flex items-center gap-2">
      <div class="flex shrink-0 items-center justify-center text-red-500 dark:text-red-400">
        <UIcon name="i-heroicons-exclamation-triangle" class="h-4 w-4" />
      </div>
      <div class="pr-5 text-[13px] font-semibold leading-[1.4] text-red-600 dark:text-red-400">
        {{ t('ai.chat.error.title') }}
      </div>
    </div>

    <!-- Description -->
    <div class="ml-6 line-clamp-3 break-words text-xs leading-normal text-gray-600 dark:text-gray-400">
      {{ getDisplayMessage(error) }}
    </div>

    <!-- Footer -->
    <div class="mt-2.5 ml-6 flex items-center">
      <div
        class="ml-auto inline-flex items-center gap-0.5 text-xs text-gray-400 transition-colors duration-150 group-hover:text-red-500 dark:text-gray-500 dark:group-hover:text-red-400"
      >
        {{ t('ai.chat.error.viewDetail') }}
        <UIcon name="i-heroicons-chevron-right" class="h-3.5 w-3.5" />
      </div>
    </div>
  </div>

  <!-- Error Detail Modal -->
  <ErrorDetailModal v-model:open="showDetail" :error="error" />
</template>
