<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useLayoutStore } from '@/stores/layout'

const { t } = useI18n()
const layoutStore = useLayoutStore()

// 打开设置弹窗并定位到自动同步子 Tab
function openSyncSettings() {
  layoutStore.openSettings('api', 'sync')
}
</script>

<template>
  <div class="w-full flex flex-col items-center space-y-6">
    <div
      class="flex h-[190px] sm:h-[220px] w-full max-w-md flex-col items-center justify-center rounded-3xl border border-gray-200/50 bg-gray-100/50 px-8 backdrop-blur-md dark:border-white/10 dark:bg-gray-800/40 select-none text-center sm:px-12"
    >
      <div class="mb-2 flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center">
        <UIcon name="i-heroicons-cloud-arrow-down" class="h-6 w-6 sm:h-8 sm:w-8 text-pink-600 dark:text-pink-400" />
      </div>
      <p class="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
        {{ t('home.tabs.apiDescription') }}
      </p>
      <UButton
        class="mt-3 font-semibold cursor-pointer"
        color="primary"
        variant="solid"
        icon="i-heroicons-cog-6-tooth"
        @click="openSyncSettings"
      >
        {{ t('home.tabs.apiButton') }}
      </UButton>
    </div>
    <!-- 占位符以对齐文件导入底部的复选框高度，保持 Tab 切换时下方元素位置稳定 -->
    <div class="h-6 w-full opacity-0 pointer-events-none" />
  </div>
</template>
