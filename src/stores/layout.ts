import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ChatRecordQuery } from '@/types/format'

/**
 * 全局界面状态（侧边栏、弹窗、聊天记录抽屉等）
 */
export const useLayoutStore = defineStore(
  'layout',
  () => {
    const isSidebarCollapsed = ref(false)
    const showScreenCaptureModal = ref(false)
    const screenCaptureImage = ref<string | null>(null)
    const showChatRecordDrawer = ref(false)
    const chatRecordQuery = ref<ChatRecordQuery | null>(null)

    const isToolsPanelLocked = ref(false)
    const isToolsPanelMini = ref(false)
    const toolsPanelPosition = ref<'side' | 'header'>('header')
    const isToolsPanelOpen = ref(false)

    // 截图设置
    const screenshotMobileAdapt = ref(false) // 截图时开启移动端适配，默认关闭

    // 设置弹窗
    const showSettings = ref(false)
    const settingsTab = ref<string>('settings')
    const settingsSubTab = ref<string | null>(null)

    /**
     * 切换侧边栏展开/折叠状态
     */
    function toggleSidebar() {
      isSidebarCollapsed.value = !isSidebarCollapsed.value
    }

    /**
     * 打开截屏预览弹窗
     */
    function openScreenCaptureModal(imageData: string) {
      screenCaptureImage.value = imageData
      showScreenCaptureModal.value = true
    }

    /**
     * 关闭截屏预览弹窗
     */
    function closeScreenCaptureModal() {
      showScreenCaptureModal.value = false
      setTimeout(() => {
        screenCaptureImage.value = null
      }, 300)
    }

    /**
     * 打开聊天记录抽屉并设置查询参数
     */
    function openChatRecordDrawer(query: ChatRecordQuery) {
      chatRecordQuery.value = query
      showChatRecordDrawer.value = true
    }

    /**
     * 关闭聊天记录抽屉并重置查询
     */
    function closeChatRecordDrawer() {
      showChatRecordDrawer.value = false
      setTimeout(() => {
        chatRecordQuery.value = null
      }, 300)
    }

    function toggleToolsPanelLock() {
      isToolsPanelLocked.value = !isToolsPanelLocked.value
    }

    function toggleToolsPanelOpen() {
      isToolsPanelOpen.value = !isToolsPanelOpen.value
    }

    /**
     * 打开设置弹窗，可选指定 Tab 和 SubTab
     */
    function openSettings(tab?: string, subTab?: string) {
      settingsTab.value = tab || 'settings'
      settingsSubTab.value = subTab || null
      showSettings.value = true
    }

    function closeSettings() {
      showSettings.value = false
    }

    function toggleToolsPanelMini() {
      isToolsPanelMini.value = !isToolsPanelMini.value
      if (isToolsPanelMini.value) {
        isToolsPanelLocked.value = false
      }
    }

    return {
      isSidebarCollapsed,
      isToolsPanelLocked,
      isToolsPanelMini,
      toolsPanelPosition,
      isToolsPanelOpen,
      showScreenCaptureModal,
      screenCaptureImage,
      showChatRecordDrawer,
      chatRecordQuery,
      screenshotMobileAdapt,
      showSettings,
      settingsTab,
      settingsSubTab,
      toggleSidebar,
      toggleToolsPanelLock,
      toggleToolsPanelOpen,
      toggleToolsPanelMini,
      openScreenCaptureModal,
      closeScreenCaptureModal,
      openChatRecordDrawer,
      closeChatRecordDrawer,
      openSettings,
      closeSettings,
    }
  },
  {
    persist: [
      {
        pick: ['isSidebarCollapsed'],
        storage: sessionStorage,
      },
      {
        pick: ['screenshotMobileAdapt', 'isToolsPanelLocked', 'isToolsPanelMini', 'toolsPanelPosition'],
        storage: localStorage,
      },
    ],
  }
)
