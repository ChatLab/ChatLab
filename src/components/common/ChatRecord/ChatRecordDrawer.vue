<script setup lang="ts">
/**
 * 聊天记录查看器 Drawer
 * 保留快速查看入口，完整的记录编排由 ChatRecordWorkspace 复用。
 */
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import ChatRecordWorkspace from './ChatRecordWorkspace.vue'
import { useLayoutStore } from '@/stores/layout'

const { t } = useI18n()
const layoutStore = useLayoutStore()

// 平台检测
const isWindows = ref(false)

onMounted(() => {
  isWindows.value = navigator.platform.toLowerCase().includes('win')
})
</script>

<template>
  <UDrawer
    v-model:open="layoutStore.showChatRecordDrawer"
    direction="right"
    :handle="false"
    handle-only
    :ui="{ content: 'z-50' }"
  >
    <template #content>
      <div
        data-vaul-no-drag
        class="chat-record-drawer-content flex h-full w-[750px] flex-col bg-white dark:bg-page-dark"
        style="-webkit-app-region: no-drag"
      >
        <!-- 头部 -->
        <div
          class="flex items-center justify-between border-b border-gray-200 px-4 dark:border-gray-800"
          :class="isWindows ? 'pt-10 pb-3' : 'py-3'"
        >
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('records.drawer.title') }}</h3>
          <UButton
            icon="i-heroicons-x-mark"
            color="neutral"
            variant="ghost"
            size="sm"
            @click="layoutStore.closeChatRecordDrawer()"
          />
        </div>

        <ChatRecordWorkspace
          class="min-h-0 flex-1"
          :initial-query="layoutStore.chatRecordQuery"
          :active="layoutStore.showChatRecordDrawer"
          mode="drawer"
        />
      </div>
    </template>
  </UDrawer>
</template>
