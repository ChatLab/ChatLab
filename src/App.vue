<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import TitleBar from '@/components/common/TitleBar.vue'
import Sidebar from '@/components/common/Sidebar.vue'
import ScreenCaptureModal from '@/components/common/ScreenCaptureModal.vue'
import SettingsModal from '@/components/common/SettingsModal.vue'
import { ChatRecordDrawer } from '@/components/common/ChatRecord'
import GlobalTaskBar from '@/components/AIChat/GlobalTaskBar.vue'
import { useSessionStore } from '@/stores/session'
import { useLayoutStore } from '@/stores/layout'
import { useSettingsStore } from '@/stores/settings'
import { useLLMStore } from '@/stores/llm'
import { useAuthStore } from '@/stores/auth'
import { initServices } from '@/services'
import { initPreferencesSync } from '@/composables/usePreferencesSync'
import { configureHttpClient } from '@/services/utils/http'
import { IS_ELECTRON } from '@/utils/platform'

const { t } = useI18n()

const sessionStore = useSessionStore()
const layoutStore = useLayoutStore()
const settingsStore = useSettingsStore()
const llmStore = useLLMStore()
const authStore = useAuthStore()
const { isInitialized } = storeToRefs(sessionStore)
const route = useRoute()
const router = useRouter()

const isLoginPage = computed(() => route.name === 'login')

const tooltip = {
  delayDuration: 100,
}

const toaster = {
  position: 'top-center' as const,
  progress: false,
  duration: 2000,
}

function handleGlobalKeydown(e: KeyboardEvent) {
  const isMeta = navigator.platform.toLowerCase().includes('mac') ? e.metaKey : e.ctrlKey
  if (isMeta && e.key === ',') {
    e.preventDefault()
    e.stopPropagation()
    if (!layoutStore.showSettings) {
      layoutStore.openSettings()
    }
  }
}

onMounted(async () => {
  window.addEventListener('keydown', handleGlobalKeydown)
  const platform = navigator.platform.toLowerCase()
  if (platform.includes('win')) {
    document.documentElement.classList.add('platform-windows')
  } else if (platform.includes('linux')) {
    document.documentElement.classList.add('platform-linux')
  }

  if (!IS_ELECTRON) {
    let redirecting = false
    const on401 = () => {
      if (redirecting || router.currentRoute.value.name === 'login') return
      redirecting = true
      const currentPath = router.currentRoute.value.fullPath
      const redirect = currentPath.startsWith('/login') ? '/' : currentPath
      authStore.logout()
      router.push({ name: 'login', query: { redirect } })
    }
    configureHttpClient({ token: authStore.token || undefined, on401 })
  }

  if (isLoginPage.value) return

  await initServices()
  await initPreferencesSync()
  await settingsStore.initLocale()
  llmStore.init()
  await sessionStore.loadSessions()
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
})
</script>

<template>
  <UApp :tooltip="tooltip" :toaster="toaster">
    <template v-if="isLoginPage">
      <router-view />
    </template>
    <template v-else>
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
    </template>
    <ScreenCaptureModal
      :open="layoutStore.showScreenCaptureModal"
      :image-data="layoutStore.screenCaptureImage"
      @update:open="(v) => (v ? null : layoutStore.closeScreenCaptureModal())"
    />
    <!-- 全局设置弹窗 -->
    <SettingsModal />
    <!-- 全局聊天记录查看器 -->
    <ChatRecordDrawer />
    <!-- 全局 AI 后台任务条：允许用户离开当前页面后仍然快速返回进行中的对话。 -->
    <GlobalTaskBar />
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
