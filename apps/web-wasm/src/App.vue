<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useColorMode, useMediaQuery } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Sidebar from '@/components/common/Sidebar.vue'
import { initializeAppRuntime } from '@/bootstrap/app-initialization'
import { initPreferencesSync } from '@/composables/usePreferencesSync'
import { resolvePageTransitionKey } from '@/routes/page-transition-key'
import { useBrowserRuntimeService } from '@/services/browser-runtime/service'
import { initServices } from '@/services/registry'
import { reportError } from '@/services/log-report'
import { useLayoutStore } from '@/stores/layout'
import { useSessionStore } from '@/stores/session'
import { useSettingsStore } from '@/stores/settings'
import { StartupLoading } from '@/components/UI'
import { PLATFORM_CAPABILITIES } from '@/utils/platform-capabilities'
import {
  WebWasmWorkspaceBusyError,
  acquireWebWasmWorkspaceLease,
  handleWebWasmWorkspacePageHide,
  type WebWasmLockManager,
  type WebWasmWorkspaceLease,
} from './workspace-lock'

const { t } = useI18n()
const route = useRoute()
const sessionStore = useSessionStore()
const settingsStore = useSettingsStore()
const layoutStore = useLayoutStore()
const { isInitialized, sessions } = storeToRefs(sessionStore)
const initError = ref<string | null>(null)
const pageTransitionKey = computed(() => resolvePageTransitionKey(route))
const shouldShowSidebar = computed(() => route.path !== '/' || sessions.value.length > 0)
const isNarrowViewport = useMediaQuery('(max-width: 767px)')

watch(
  isNarrowViewport,
  (isNarrow) => {
    // Web WASM 的移动端保留会话导航入口，但默认折叠，避免侧栏挤占详情内容。
    if (isNarrow) layoutStore.isSidebarCollapsed = true
  },
  { immediate: true }
)

useColorMode({
  emitAuto: true,
  initialValue: 'light',
})

const tooltip = { delayDuration: 100 }
const toaster = {
  position: 'top-center' as const,
  progress: false,
  duration: 2000,
}

let initInProgress = false
let workspaceLease: WebWasmWorkspaceLease | undefined

async function initializeApp() {
  if (initInProgress || isInitialized.value) return
  initInProgress = true
  initError.value = null

  try {
    workspaceLease ??= await acquireWebWasmWorkspaceLease(navigator.locks as WebWasmLockManager | undefined)
    await initializeAppRuntime({
      capabilities: PLATFORM_CAPABILITIES,
      initializeServices: () => initServices(),
      checkBrowserCapabilities: () => useBrowserRuntimeService().checkCapabilities(),
      initializePreferences: () => initPreferencesSync(),
      initializeLocale: () => settingsStore.initLocale(),
      loadSessions: () => sessionStore.loadSessions({ throwOnError: true }),
    })
  } catch (error) {
    console.error('Web WASM application initialization failed', error)
    initError.value =
      error instanceof WebWasmWorkspaceBusyError
        ? t('common.webWasmWorkspaceBusy')
        : error instanceof Error
          ? error.message
          : String(error)
    reportError(initError.value, error instanceof Error ? error.stack : undefined)
  } finally {
    initInProgress = false
  }
}

function releaseWorkspaceLease() {
  workspaceLease?.release()
  workspaceLease = undefined
}

function handlePageHide(event: PageTransitionEvent) {
  workspaceLease = handleWebWasmWorkspacePageHide(event, workspaceLease)
}

onMounted(() => {
  window.addEventListener('pagehide', handlePageHide)
  void initializeApp()
})
onBeforeUnmount(() => {
  window.removeEventListener('pagehide', handlePageHide)
  releaseWorkspaceLease()
})
</script>

<template>
  <UApp :tooltip="tooltip" :toaster="toaster">
    <div class="relative flex h-screen w-full overflow-hidden bg-page-bg dark:bg-page-dark">
      <template v-if="!isInitialized">
        <div class="flex h-full w-full items-center justify-center">
          <div v-if="initError" class="flex flex-col items-center justify-center gap-3 px-6 text-center">
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
        <Sidebar v-if="shouldShowSidebar" :backend-features="false" />
        <main class="relative flex-1 overflow-hidden">
          <router-view v-slot="{ Component }">
            <Transition name="page-fade" mode="out-in">
              <component :is="Component" :key="pageTransitionKey" />
            </Transition>
          </router-view>
        </main>
      </template>
    </div>
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
