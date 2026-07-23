<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from 'vue'
import { useColorMode } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import TitleBar from '@/components/common/TitleBar.vue'
import Sidebar from '@/components/common/Sidebar.vue'
import ScreenCaptureModal from '@/components/common/ScreenCaptureModal.vue'
import SettingsModal from '@/components/common/SettingsModal.vue'
import { ChatRecordDrawer } from '@/components/common/ChatRecord'
import GlobalTaskBar from '@/components/AIChat/GlobalTaskBar.vue'
import DebugToolsPanel from '@/components/layout/DebugToolsPanel.vue'
import { StartupLoading } from '@/components/UI'
import { useSessionStore } from '@/stores/session'
import { useLayoutStore } from '@/stores/layout'
import { useSettingsStore } from '@/stores/settings'
import { useLLMStore } from '@/stores/llm'
import { useAuthStore } from '@/stores/auth'
import { useApiServerStore } from '@/stores/apiServer'
import { initServices } from '@/services'
import { initPreferencesSync } from '@/composables/usePreferencesSync'
import { useWindowsTitleBarOverlay } from '@/composables/useWindowsTitleBarOverlay'
import { configureHttpClient } from '@/services/utils/http'
import { IS_ELECTRON } from '@/utils/platform'
import { PLATFORM_CAPABILITIES } from '@/utils/platform-capabilities'
import { usePlatformService } from '@/services'
import { resolvePageTransitionKey } from '@/routes/page-transition-key'
import { useLockScreenBootstrap } from '@/components/lock-screen/bootstrap'
import { initializeAppRuntime } from '@/bootstrap/app-initialization'

const LockScreen = IS_ELECTRON ? defineAsyncComponent(() => import('@/components/lock-screen/LockScreen.vue')) : null
const DataDirCleanupNotice = defineAsyncComponent(() => import('@/components/common/DataDirCleanupNotice.vue'))

const { t } = useI18n()

const sessionStore = useSessionStore()
const layoutStore = useLayoutStore()
const settingsStore = useSettingsStore()
const llmStore = useLLMStore()
const authStore = useAuthStore()
const apiServerStore = useApiServerStore()
const { isInitialized } = storeToRefs(sessionStore)
const route = useRoute()
const router = useRouter()
const { isBootstrapMaskVisible, isApplicationInteractive, markLockScreenReady, syncBootstrapMask, updateLockState } =
  useLockScreenBootstrap(IS_ELECTRON)

const isLoginPage = computed(() => PLATFORM_CAPABILITIES.requiresAuth && route.name === 'login')
const pageTransitionKey = computed(() => resolvePageTransitionKey(route))
const initError = ref<string | null>(null)
const bootstrapDialogRef = ref<HTMLDialogElement | null>(null)
const colorMode = useColorMode({
  emitAuto: true,
  initialValue: 'light',
})

const tooltip = {
  delayDuration: 100,
}

const toaster = {
  position: 'top-center' as const,
  progress: false,
  duration: 2000,
}

let initInProgress = false
let unlistenPullResult: (() => void) | null = null

async function initializeApp() {
  if (initInProgress || isInitialized.value) return
  initInProgress = true
  initError.value = null
  try {
    const result = await initializeAppRuntime({
      capabilities: PLATFORM_CAPABILITIES,
      initializeServices: () => initServices(),
      initializePreferences: () => initPreferencesSync(),
      initializeLocale: () => settingsStore.initLocale(),
      initializeLlm: () => llmStore.init(),
      loadSessions: () => sessionStore.loadSessions(),
      listenForPullResults: () => apiServerStore.listenPullResult(),
    })
    unlistenPullResult ??= result.stopListeningForPullResults
    usePlatformService()
      .trackDailyActive(settingsStore.locale)
      .catch(() => {})
  } catch (err) {
    console.error('App initialization failed:', err)
    initError.value = err instanceof Error ? err.message : String(err)
  } finally {
    initInProgress = false
  }
}

function handleGlobalKeydown(e: KeyboardEvent) {
  if (!isApplicationInteractive.value) return
  const isMeta = navigator.platform.toLowerCase().includes('mac') ? e.metaKey : e.ctrlKey
  // Ctrl+, → 打开设置
  if (isMeta && e.key === ',') {
    e.preventDefault()
    e.stopPropagation()
    if (!layoutStore.showSettings) {
      layoutStore.openSettings()
    }
    return
  }
}

// After login success, route changes from login → app; trigger init
watch(isLoginPage, (isLogin) => {
  if (!isLogin) initializeApp()
})

watch(
  colorMode,
  (val) => {
    if (!IS_ELECTRON) return
    const mode = val === 'auto' ? 'system' : (val as 'light' | 'dark')
    window.api?.setThemeSource(mode)
  },
  { immediate: true }
)

watch(isBootstrapMaskVisible, () => syncBootstrapMask(bootstrapDialogRef.value), { flush: 'post' })

useWindowsTitleBarOverlay([
  colorMode,
  () => route.fullPath,
  () => layoutStore.showSettings,
  () => layoutStore.showScreenCaptureModal,
  () => layoutStore.showChatRecordDrawer,
])

onMounted(async () => {
  // 同步原生 modal 在异步锁屏就绪前保持底层文档 inert；chunk 加载失败时不会自动放行。
  syncBootstrapMask(bootstrapDialogRef.value)
  window.addEventListener('keydown', handleGlobalKeydown)
  const platform = navigator.platform.toLowerCase()
  if (platform.includes('win')) {
    document.documentElement.classList.add('platform-windows')
  } else if (platform.includes('linux')) {
    document.documentElement.classList.add('platform-linux')
  }

  if (IS_ELECTRON) {
    // Electron: get Internal API Server endpoint from preload
    const ep = await window.internalApi?.getEndpoint()
    if (ep) {
      configureHttpClient({ baseUrl: `${ep.baseUrl}/_web`, token: ep.token })
    }
  } else if (PLATFORM_CAPABILITIES.usesCliWebHttp) {
    // CLI Web: use relative paths + dynamic token from auth store
    let redirectingTo401 = false
    const on401 = () => {
      if (redirectingTo401 || router.currentRoute.value.name === 'login') return
      redirectingTo401 = true
      authStore.markRequiresAuth()
      authStore.logout()
      const currentPath = router.currentRoute.value.fullPath
      const redirect = currentPath.startsWith('/login') ? '/' : currentPath
      router.push({ name: 'login', query: { redirect } }).finally(() => {
        redirectingTo401 = false
      })
    }
    configureHttpClient({ getToken: () => authStore.token, on401 })
  }

  if (isLoginPage.value) return

  await initializeApp()
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
  unlistenPullResult?.()
  unlistenPullResult = null
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
      <div class="relative flex h-screen w-full overflow-hidden bg-page-bg dark:bg-page-dark">
        <!-- 主内容区域 -->
        <template v-if="!isInitialized">
          <div class="flex h-full w-full items-center justify-center">
            <div v-if="initError" class="flex flex-col items-center justify-center gap-3 text-center">
              <UIcon name="i-heroicons-exclamation-triangle" class="h-8 w-8 text-red-500" />
              <p class="text-sm text-gray-700 dark:text-gray-300">{{ t('common.initFailed') }}</p>
              <p class="max-w-sm text-xs text-gray-500">{{ initError }}</p>
              <UButton size="sm" color="primary" variant="soft" @click="initializeApp">
                {{ t('common.retry') }}
              </UButton>
            </div>
            <StartupLoading v-else />
          </div>
        </template>
        <template v-else>
          <Sidebar :backend-features="true" />
          <main class="relative flex-1 overflow-hidden">
            <router-view v-slot="{ Component }">
              <Transition name="page-fade" mode="out-in">
                <component :is="Component" :key="pageTransitionKey" />
              </Transition>
            </router-view>
          </main>
          <DebugToolsPanel v-if="settingsStore.debugMode" />
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
    <!-- Desktop 与 CLI Web 迁移后都提醒人工清理。 -->
    <DataDirCleanupNotice v-if="!isLoginPage && isInitialized" />
    <!-- 原生模态锁屏：锁定后由浏览器 top layer 隔离全部底层操作 -->
    <LockScreen v-if="IS_ELECTRON" @ready="markLockScreenReady" @lock-state-change="updateLockState" />
    <Teleport v-if="IS_ELECTRON" to="body">
      <dialog
        ref="bootstrapDialogRef"
        :aria-label="t('common.initializing')"
        aria-busy="true"
        class="pointer-events-auto m-0 h-screen max-h-none w-screen max-w-none border-0 bg-white p-0 outline-none backdrop:bg-white dark:bg-page-dark dark:backdrop:bg-page-dark"
        tabindex="-1"
        @cancel.prevent
      >
        <StartupLoading v-if="isBootstrapMaskVisible" />
      </dialog>
    </Teleport>
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
