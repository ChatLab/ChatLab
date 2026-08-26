<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, provide, readonly, ref, watch } from 'vue'
import { useColorMode } from '@vueuse/core'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import TitleBar from '@/components/common/TitleBar.vue'
import Sidebar from '@/components/common/Sidebar.vue'
import { StartupLoading, UiButton, UiIcon } from '@/components/UI'
import { useSessionStore } from '@/stores/session'
import { useLayoutStore } from '@/stores/layout'
import { useSettingsStore } from '@/stores/settings'
import { useLLMStore } from '@/stores/llm'
import { useAuthStore } from '@/stores/auth'
import { useApiServerStore } from '@/stores/apiServer'
import { initServices } from '@/services'
import {
  applyPresentationPreferences,
  initPreferencesSync,
  loadPresentationPreferences,
} from '@/composables/usePreferencesSync'
import { useWindowsTitleBarOverlay } from '@/composables/useWindowsTitleBarOverlay'
import { configureHttpClient } from '@/services/utils/http'
import { reportError } from '@/services/log-report'
import { IS_ELECTRON } from '@/utils/platform'
import { PLATFORM_CAPABILITIES } from '@/utils/platform-capabilities'
import { usePlatformService } from '@/services'
import { useNavigationLayoutService } from '@/services'
import { NAVIGATION_LAYOUT_CUSTOMIZATION_ENABLED } from '@/navigation/layout'
import { useNavigationLayout } from '@/navigation/vue'
import { redirectFromHiddenInsightPage } from '@/navigation/router'
import type { PresentationPreferences } from '@/services/preferences/types'
import { resolvePageTransitionKey } from '@/routes/page-transition-key'
import { useLockScreenBootstrap } from '@/components/lock-screen/bootstrap'
import { initializeAppRuntime, initializeProgressiveAppRuntime } from '@/bootstrap/app-initialization'
import { markStartupPhase, markStartupPhaseAfterPaint } from '@/bootstrap/startup-performance'
import { resolveStartupPresentation } from '@/bootstrap/startup-presentation'
import { STARTUP_PAGE_REVEAL_READY_KEY } from '@/bootstrap/startup-page-reveal'
import { claimFullStartupPresentation } from '@/bootstrap/startup-playback'

const LockScreen = IS_ELECTRON ? defineAsyncComponent(() => import('@/components/lock-screen/LockScreen.vue')) : null
const DataDirCleanupNotice = defineAsyncComponent(() => import('@/components/common/DataDirCleanupNotice.vue'))
const loadScreenCaptureModal = () => import('@/components/common/ScreenCaptureModal.vue')
const loadSettingsModal = () => import('@/components/common/SettingsModal.vue')
const loadChatRecordDrawer = () => import('@/components/common/ChatRecord/ChatRecordDrawer.vue')
const loadGlobalTaskBar = () => import('@/components/AIChat/GlobalTaskBar.vue')
const loadDebugToolsPanel = () => import('@/components/layout/DebugToolsPanel.vue')
const ScreenCaptureModal = defineAsyncComponent(loadScreenCaptureModal)
const SettingsModal = defineAsyncComponent(loadSettingsModal)
const ChatRecordDrawer = defineAsyncComponent(loadChatRecordDrawer)
const GlobalTaskBar = defineAsyncComponent(loadGlobalTaskBar)
const DebugToolsPanel = defineAsyncComponent(loadDebugToolsPanel)

const { t } = useI18n()

const sessionStore = useSessionStore()
const layoutStore = useLayoutStore()
const settingsStore = useSettingsStore()
const llmStore = useLLMStore()
const authStore = useAuthStore()
const apiServerStore = useApiServerStore()
const route = useRoute()
const router = useRouter()
const { controller: navigationLayoutController } = useNavigationLayout()
const { isBootstrapMaskVisible, isApplicationInteractive, markLockScreenReady, syncBootstrapMask, updateLockState } =
  useLockScreenBootstrap(IS_ELECTRON)

const isLoginPage = computed(() => PLATFORM_CAPABILITIES.requiresAuth && route.name === 'login')
const pageTransitionKey = computed(() => resolvePageTransitionKey(route))
const isRuntimeReady = ref(false)
const shouldWaitForFullStartup = ref(true)
const isStartupAnimationComplete = ref(false)
const isStartupPageEntering = ref(false)
const isStartupCoverHidden = ref(false)
const initError = ref<string | null>(null)
const presentationWarning = ref(false)
const settingsModalMounted = ref(layoutStore.showSettings)
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

const startupPresentation = computed(() =>
  resolveStartupPresentation({
    runtimeReady: isRuntimeReady.value,
    animationComplete: isStartupAnimationComplete.value,
    waitForAnimation: shouldWaitForFullStartup.value,
    initializationFailed: initError.value !== null,
  })
)

provide(STARTUP_PAGE_REVEAL_READY_KEY, readonly(isStartupPageEntering))

let initInProgress = false
let unlistenPullResult: (() => void) | null = null
let cancelNonCriticalUiPrefetch: (() => void) | null = null
let startupPlaybackPrepared = false

function prepareStartupPlayback(): void {
  if (startupPlaybackPrepared) return
  startupPlaybackPrepared = true
  shouldWaitForFullStartup.value = claimFullStartupPresentation()
}

if (!isLoginPage.value) prepareStartupPlayback()

function scheduleNonCriticalUiPrefetch() {
  if (cancelNonCriticalUiPrefetch) return
  const prefetch = () => {
    cancelNonCriticalUiPrefetch = null
    void Promise.allSettled([
      loadSettingsModal(),
      loadChatRecordDrawer(),
      loadScreenCaptureModal(),
      loadDebugToolsPanel(),
    ])
  }

  if (typeof window.requestIdleCallback === 'function') {
    const idleId = window.requestIdleCallback(prefetch, { timeout: 3_000 })
    cancelNonCriticalUiPrefetch = () => window.cancelIdleCallback(idleId)
    return
  }

  const timer = window.setTimeout(prefetch, 1_000)
  cancelNonCriticalUiPrefetch = () => window.clearTimeout(timer)
}

async function hydrateNavigationLayout(): Promise<void> {
  if (!NAVIGATION_LAYOUT_CUSTOMIZATION_ENABLED) return

  try {
    const result = await useNavigationLayoutService().load()
    navigationLayoutController.applyLoadResult(result)
  } catch (error) {
    navigationLayoutController.applyLoadFailure()
    const normalized = error instanceof Error ? error : new Error(String(error))
    reportError(`Navigation layout load failed: ${normalized.message}`, normalized.stack)
  }

  await redirectFromHiddenInsightPageSafely()
}

async function redirectFromHiddenInsightPageSafely(): Promise<void> {
  try {
    await redirectFromHiddenInsightPage(router, navigationLayoutController)
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error))
    reportError(`Navigation layout route fallback failed: ${normalized.message}`, normalized.stack)
  }
}

async function initializeApp() {
  if (initInProgress || isRuntimeReady.value) return
  initInProgress = true
  initError.value = null
  presentationWarning.value = false
  try {
    if (!PLATFORM_CAPABILITIES.usesBrowserRuntime) {
      let presentationPromise: Promise<PresentationPreferences> | undefined
      let presentationInitialized = false
      const result = await initializeProgressiveAppRuntime({
        initializeServices: async () => {
          await initServices()
          markStartupPhase('services-ready')
        },
        loadPresentation: () => {
          presentationPromise ??= loadPresentationPreferences()
          return presentationPromise
        },
        applyPresentation: async (presentation) => {
          applyPresentationPreferences(presentation)
          presentationInitialized = true
          await settingsStore.initLocale()
          markStartupPhase('locale-settled')
        },
        applyPresentationFallback: async () => {
          await settingsStore.initLocale()
          markStartupPhase('locale-settled')
        },
        deferAfterPresentationError: () =>
          PLATFORM_CAPABILITIES.requiresAuth && authStore.requiresAuth && !authStore.isAuthenticated,
        initializeShell: hydrateNavigationLayout,
        initializeBackground: [
          {
            name: 'preferences',
            run: async () => {
              try {
                await initPreferencesSync({
                  presentationInitialized,
                  presentationPromise,
                  hydratePresentationLocale: false,
                })
              } finally {
                markStartupPhase('preferences-settled')
              }
            },
          },
          {
            name: 'llm',
            run: async () => {
              try {
                await llmStore.init()
              } finally {
                markStartupPhase('llm-settled')
              }
            },
          },
          {
            name: 'sessions',
            run: async () => {
              try {
                await sessionStore.loadSessions({ throwOnError: true })
              } finally {
                markStartupPhase('sessions-settled')
              }
            },
          },
        ],
        listenForPullResults: () => apiServerStore.listenPullResult(),
      })
      // 401 会先切换到登录页；不要把这次未认证尝试标记为就绪，登录后由 route watcher 完整重试。
      if (result.deferred) return
      unlistenPullResult ??= result.stopListeningForPullResults
      presentationWarning.value = result.presentationError !== null
      markStartupPhase('runtime-ready')
      isRuntimeReady.value = true
      void result.background.then((failures) => {
        failures.forEach(({ name, error }) => console.error(`[Startup] Background task failed: ${name}`, error))
        markStartupPhase('startup-settled')
      })
      usePlatformService()
        .trackDailyActive(settingsStore.locale)
        .catch(() => {})
      return
    }

    const result = await initializeAppRuntime({
      capabilities: PLATFORM_CAPABILITIES,
      initializeServices: async () => {
        await initServices()
        markStartupPhase('services-ready')
      },
      initializePreferences: async () => {
        await initPreferencesSync()
        markStartupPhase('preferences-settled')
      },
      initializeLocale: async () => {
        await settingsStore.initLocale()
        markStartupPhase('locale-settled')
      },
      initializeLlm: async () => {
        await llmStore.init()
        markStartupPhase('llm-settled')
      },
      loadSessions: async () => {
        await sessionStore.loadSessions()
        markStartupPhase('sessions-settled')
      },
      listenForPullResults: () => apiServerStore.listenPullResult(),
    })
    unlistenPullResult ??= result.stopListeningForPullResults
    markStartupPhase('runtime-ready')
    isRuntimeReady.value = true
    markStartupPhase('startup-settled')
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

function handleStartupAnimationComplete(): void {
  isStartupAnimationComplete.value = true
  markStartupPhase('startup-animation-complete')
}

function handleStartupCoverBeforeLeave(): void {
  // 页面已在遮罩下完成预热；遮罩淡出时重放原有入场动效，避免动画提前在背后结束。
  isStartupPageEntering.value = true
}

async function handleStartupCoverHidden(): Promise<void> {
  isStartupCoverHidden.value = true
  markStartupPhase('splash-hidden')
  await nextTick()
  await markStartupPhaseAfterPaint('shell-interactive')
}

function handleGlobalKeydown(e: KeyboardEvent) {
  if (!isStartupCoverHidden.value || !isApplicationInteractive.value) return
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
  if (!isLogin) {
    prepareStartupPlayback()
    initializeApp()
  }
})

watch(
  () => layoutStore.showSettings,
  (visible) => {
    if (visible) settingsModalMounted.value = true
  }
)

watch(isRuntimeReady, async (ready) => {
  if (!ready) return
  await nextTick()
  await markStartupPhaseAfterPaint('shell-mounted')
  scheduleNonCriticalUiPrefetch()
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

watch(
  () => route.meta.insightPageId,
  () => void redirectFromHiddenInsightPageSafely()
)

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
  if (IS_ELECTRON) {
    document.documentElement.classList.add('platform-electron')
    const platform = navigator.platform.toLowerCase()
    if (platform.includes('win')) {
      document.documentElement.classList.add('platform-windows')
    } else if (platform.includes('linux')) {
      document.documentElement.classList.add('platform-linux')
    }
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
      authStore.requireLogin()
      const currentPath = router.currentRoute.value.fullPath
      const redirect = currentPath.startsWith('/login') ? '/' : currentPath
      router.push({ name: 'login', query: { redirect } }).finally(() => {
        redirectingTo401 = false
      })
    }
    configureHttpClient({ getToken: () => authStore.token, on401 })
  }

  if (isLoginPage.value) return

  prepareStartupPlayback()
  await initializeApp()
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
  unlistenPullResult?.()
  unlistenPullResult = null
  cancelNonCriticalUiPrefetch?.()
  cancelNonCriticalUiPrefetch = null
})
</script>

<template>
  <UApp :tooltip="tooltip" :toaster="toaster">
    <template v-if="isLoginPage">
      <router-view />
    </template>
    <template v-else>
      <!-- 自定义标题栏 - 拖拽区域 + 窗口控制按钮 -->
      <TitleBar v-if="IS_ELECTRON" />
      <div class="relative flex h-screen w-full overflow-hidden bg-page-bg dark:bg-page-dark">
        <!-- 运行时就绪后先在启动屏下挂载真实界面，利用动画时间完成布局和页面预热。 -->
        <div
          v-if="startupPresentation.mountShell"
          class="flex min-w-0 flex-1 overflow-hidden"
          :inert="!isStartupCoverHidden"
          :aria-hidden="!isStartupCoverHidden ? 'true' : undefined"
        >
          <Sidebar :backend-features="true" />
          <main class="relative flex-1 overflow-hidden" :class="{ 'startup-page-entering': isStartupPageEntering }">
            <div
              v-if="presentationWarning"
              class="absolute inset-x-3 top-3 z-30 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 shadow-sm dark:border-amber-800 dark:bg-amber-950/80 dark:text-amber-200"
              role="status"
            >
              {{ t('common.presentationFallback') }}
            </div>
            <router-view v-slot="{ Component }">
              <Transition name="page-fade" mode="out-in">
                <component :is="Component" :key="pageTransitionKey" />
              </Transition>
            </router-view>
          </main>
          <DebugToolsPanel v-if="settingsStore.debugMode" />
        </div>

        <Transition
          name="startup-cover"
          @before-leave="handleStartupCoverBeforeLeave"
          @after-leave="handleStartupCoverHidden"
        >
          <div
            v-if="startupPresentation.showCover"
            class="absolute inset-0 z-40 flex items-center justify-center bg-page-bg dark:bg-page-dark"
          >
            <div
              v-if="startupPresentation.showError"
              class="flex flex-col items-center justify-center gap-3 text-center"
            >
              <UiIcon name="i-heroicons-exclamation-triangle" class="h-8 w-8 text-red-500" />
              <p class="text-sm text-gray-700 dark:text-gray-300">{{ t('common.initFailed') }}</p>
              <p class="max-w-sm text-xs text-gray-500">{{ initError }}</p>
              <UiButton size="sm" variant="soft" @click="initializeApp">
                {{ t('common.retry') }}
              </UiButton>
            </div>
            <StartupLoading
              v-else
              :waiting="startupPresentation.showWaitingIndicator"
              @complete="handleStartupAnimationComplete"
            />
          </div>
        </Transition>
      </div>
    </template>
    <ScreenCaptureModal
      v-if="layoutStore.showScreenCaptureModal || layoutStore.screenCaptureImage"
      :open="layoutStore.showScreenCaptureModal"
      :image-data="layoutStore.screenCaptureImage"
      @update:open="(v) => (v ? null : layoutStore.closeScreenCaptureModal())"
    />
    <!-- 全局设置弹窗 -->
    <SettingsModal v-if="settingsModalMounted" />
    <!-- 全局聊天记录查看器 -->
    <ChatRecordDrawer v-if="layoutStore.showChatRecordDrawer || layoutStore.chatRecordQuery" />
    <!-- 全局 AI 后台任务条：允许用户离开当前页面后仍然快速返回进行中的对话。 -->
    <GlobalTaskBar />
    <!-- Desktop 与 CLI Web 迁移后都提醒人工清理。 -->
    <DataDirCleanupNotice v-if="!isLoginPage && isStartupCoverHidden" />
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
.startup-page-entering {
  animation: startup-page-enter 0.2s ease both;
}

.startup-cover-leave-active {
  transition: opacity 180ms ease-out;
}

.startup-cover-leave-to {
  opacity: 0;
}

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

@keyframes startup-page-enter {
  from {
    opacity: 0;
    transform: translateY(10px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .startup-page-entering {
    animation: none;
  }

  .startup-cover-leave-active {
    transition: none;
  }
}
</style>
