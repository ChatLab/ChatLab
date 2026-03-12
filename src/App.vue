<script setup lang="ts">
import { onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import TitleBar from '@/components/common/TitleBar.vue'
import Sidebar from '@/components/common/Sidebar.vue'
import ScreenCaptureModal from '@/components/common/ScreenCaptureModal.vue'
import { ChatRecordDrawer } from '@/components/common/ChatRecord'
import { useSessionStore } from '@/stores/session'
import { useLayoutStore } from '@/stores/layout'
import { useSettingsStore } from '@/stores/settings'
import { useLLMStore } from '@/stores/llm'

const { t } = useI18n()

const sessionStore = useSessionStore()
const layoutStore = useLayoutStore()
const settingsStore = useSettingsStore()
const llmStore = useLLMStore()
const { isInitialized } = storeToRefs(sessionStore)
const route = useRoute()

const tooltip = {
  delayDuration: 100,
}

// 应用启动时初始化
onMounted(async () => {
  // 平台检测 - 设置 CSS 类名以驱动平台差异化样式（如标题栏安全区域高度）
  const platform = navigator.platform.toLowerCase()
  if (platform.includes('win')) {
    document.documentElement.classList.add('platform-windows')
  } else if (platform.includes('linux')) {
    document.documentElement.classList.add('platform-linux')
  }

  // 初始化语言设置（同步 i18n 和 dayjs，异步加载脱敏规则）
  await settingsStore.initLocale()
  // 初始化 LLM 配置（预加载，避免首次使用时延迟）
  llmStore.init()
  // 从数据库加载会话列表
  await sessionStore.loadSessions()
})
</script>

<template>
  <UApp :tooltip="tooltip">
    <!-- 自定义标题栏 - 拖拽区域 + 窗口控制按钮 -->
    <TitleBar />
    <div class="relative flex h-screen w-full overflow-hidden bg-gray-50 dark:bg-gray-900">
      <!-- 主内容区域 -->
      <template v-if="!isInitialized">
        <div class="flex h-full w-full items-center justify-center">
          <div class="flex flex-col items-center justify-center text-center">
            <UIcon name="i-heroicons-arrow-path" class="h-8 w-8 animate-spin text-pink-500" />
            <p class="mt-2 text-sm text-gray-500">{{ t('common.initializing') }}</p>
          </div>
        </div>
      </template>
      <template v-else>
        <Sidebar />
        <main class="relative flex-1 overflow-hidden">
          <router-view v-slot="{ Component }">
            <Transition name="page-fade" mode="out-in">
              <component :is="Component" :key="route.path" />
            </Transition>
          </router-view>
        </main>
      </template>
    </div>
    <ScreenCaptureModal
      :open="layoutStore.showScreenCaptureModal"
      :image-data="layoutStore.screenCaptureImage"
      @update:open="(v) => (v ? null : layoutStore.closeScreenCaptureModal())"
    />
    <!-- 全局聊天记录查看器 -->
    <ChatRecordDrawer />
  </UApp>
</template>

<style scoped>
.page-fade-enter-active,
.page-fade-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.page-fade-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.page-fade-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
