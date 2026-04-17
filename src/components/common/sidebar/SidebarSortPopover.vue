<script setup lang="ts">
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useSessionStore } from '@/stores/session'

const { t } = useI18n()
const sessionStore = useSessionStore()
const { sortField, sortOrder } = storeToRefs(sessionStore)

// 排序弹出框
const isSortPopoverOpen = ref(false)

// 排序选项配置
type SortOption = { value: 'importedAt' | 'lastMessageTs' | 'messageCount'; labelKey: string }
const sortOptions: SortOption[] = [
  { value: 'importedAt', labelKey: 'layout.sort.importedAt' },
  { value: 'lastMessageTs', labelKey: 'layout.sort.lastMessageTs' },
  { value: 'messageCount', labelKey: 'layout.sort.messageCount' },
]

function handleSortSelect(field: SortOption['value']) {
  if (sortField.value === field) {
    sortOrder.value = sortOrder.value === 'desc' ? 'asc' : 'desc'
  } else {
    sortField.value = field
    sortOrder.value = 'desc'
  }
  isSortPopoverOpen.value = false
}
</script>

<template>
  <UPopover v-model:open="isSortPopoverOpen" :ui="{ content: 'z-50 p-0' }">
    <UTooltip :text="t('layout.tooltip.sort')" :popper="{ placement: 'right' }">
      <UButton
        :icon="sortOrder === 'desc' ? 'i-heroicons-bars-arrow-down' : 'i-heroicons-bars-arrow-up'"
        color="neutral"
        variant="ghost"
        size="xs"
      />
    </UTooltip>
    <template #content>
      <div class="w-48 p-1.5 flex flex-col space-y-0.5">
        <!-- 头部标题 -->
        <div class="px-2 pb-2 pt-1 text-xs font-semibold text-gray-500 dark:text-gray-400">
          {{ t('layout.tooltip.sort') }}
        </div>

        <!-- 排序项 -->
        <button
          v-for="opt in sortOptions"
          :key="opt.value"
          class="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-sm transition-colors"
          :class="
            sortField === opt.value
              ? 'bg-gray-100 text-gray-900 dark:bg-white/10 dark:text-white font-medium'
              : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/5'
          "
          @click="handleSortSelect(opt.value)"
        >
          <span>{{ t(opt.labelKey) }}</span>
          <UIcon
            v-if="sortField === opt.value"
            :name="sortOrder === 'desc' ? 'i-heroicons-bars-arrow-down' : 'i-heroicons-bars-arrow-up'"
            class="h-4 w-4 opacity-70"
          />
        </button>
      </div>
    </template>
  </UPopover>
</template>
